"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, findScopedAsset, requireOrg, siteScope, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ASSET_STATUS, COMPONENT_ROLES, DOC_CATEGORIES, features } from "@/lib/assets";
import { readFieldValues } from "@/lib/asset-values";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, putFile } from "@/lib/storage";
import { recordReading, ReadingError } from "@/lib/meters";
import { openTransferFor } from "@/lib/transfers";
import { str, token } from "@/lib/forms";
import { nextNumber } from "@/lib/asset-number";
import { localInputToDate } from "@/lib/format";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

async function scopedSite(ctx: Ctx, siteId: string) {
  return db.site.findFirst({ where: { AND: [siteScope(ctx), { id: siteId, active: true }] } });
}

async function ownAsset(ctx: Ctx, id: string, path = "/assets") {
  const a = await findScopedAsset(ctx, id);
  if (!a) back(path, "Asset not found or not in your scope.");
  return a;
}

/** Location and custody are controlled by an open transfer until it completes. */
async function assertNotInTransfer(assetId: string) {
  const open = await openTransferFor([assetId]);
  if (open) back(`/assets/${assetId}`, `This asset is in open transfer ${open.transfer.number}. Finish or cancel the transfer first.`);
}

const MANUAL_STATUSES = ["active", "in_maintenance", "refurbishing", "quarantined", "retired", "scrapped"];

export async function createAssetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "create");
  const type = await db.assetType.findFirst({ where: { id: str(fd, "assetTypeId"), orgId: ctx.org.id, archived: false }, include: { fields: true } });
  const path = `/assets/new?type=${str(fd, "assetTypeId")}`;
  if (!type) back("/assets/new", "Choose an asset type.");
  const name = str(fd, "name");
  if (!name) back(path, "Name is required.");
  const site = await scopedSite(ctx, str(fd, "siteId"));
  if (!site) back(path, "Choose a site you have access to.");
  const number = str(fd, "number") || (await nextNumber(ctx.org.id, type.numberPrefix));
  if (await db.asset.findFirst({ where: { orgId: ctx.org.id, number } })) back(path, `Asset number ${number} is already used.`);
  const v = readFieldValues((k) => (fd.has(k) ? str(fd, k) : undefined), type.kind, type.fields);
  if (v.errors.length) back(path, v.errors.join("; "));
  const owner = str(fd, "ownerPartnerId") || null;
  if (owner && !(await db.partner.findFirst({ where: { id: owner, orgId: ctx.org.id } }))) back(path, "Unknown owner.");
  const toolmaker = str(fd, "toolmakerPartnerId") || null;

  const asset = await db.$transaction(async (tx) => {
    const a = await tx.asset.create({
      data: {
        ...(v.std as Prisma.AssetUncheckedCreateInput),
        orgId: ctx.org.id,
        assetTypeId: type.id,
        number,
        name,
        qrToken: token(12),
        siteId: site.id,
        custodianPartnerId: site.partnerId, // custody follows the holding site; changes later only via transfers
        ownerPartnerId: owner,
        toolmakerPartnerId: toolmaker,
        locationDetail: str(fd, "locationDetail"),
        program: str(fd, "program"),
        notes: str(fd, "notes"),
        customValues: v.custom as Prisma.InputJsonValue,
      } as Prisma.AssetUncheckedCreateInput,
    });
    const f = features(type.features);
    if (f.meters) await tx.meter.create({ data: { assetId: a.id, kind: "shots", name: "Shot counter", unit: "shots" } });
    if (f.cavities && a.designCavities && a.designCavities <= 256) {
      await tx.cavity.createMany({ data: Array.from({ length: a.designCavities }, (_, i) => ({ assetId: a.id, identifier: String(i + 1) })) });
    }
    await audit(ctx, { action: "created", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: a }, tx);
    return a;
  });
  back(`/assets/${asset.id}`, `${asset.number} created.`, "ok");
}

export async function updateAssetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${a.id}/edit`;
  const type = await db.assetType.findUniqueOrThrow({ where: { id: a.assetTypeId }, include: { fields: true } });
  const name = str(fd, "name");
  if (!name) back(path, "Name is required.");
  const v = readFieldValues((k) => (fd.has(k) ? str(fd, k) : undefined), type.kind, type.fields, a.customValues as Record<string, unknown>);
  if (v.errors.length) back(path, v.errors.join("; "));
  const owner = str(fd, "ownerPartnerId") || null;
  if (owner && !(await db.partner.findFirst({ where: { id: owner, orgId: ctx.org.id } }))) back(path, "Unknown owner.");
  const after = await db.asset.update({
    where: { id: a.id },
    data: {
      ...(v.std as Prisma.AssetUncheckedUpdateInput),
      name,
      ownerPartnerId: owner,
      toolmakerPartnerId: str(fd, "toolmakerPartnerId") || null,
      program: str(fd, "program"),
      assignment: str(fd, "assignment"),
      notes: str(fd, "notes"),
      customValues: v.custom as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, { action: "updated", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${name}`, before: a, after });
  back(`/assets/${a.id}?tab=specs`, "Saved.", "ok");
}

/** Move within the current custodian's sites. Custody itself changes only through transfers. */
export async function moveAssetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  await assertNotInTransfer(a.id);
  const path = `/assets/${a.id}`;
  const site = await scopedSite(ctx, str(fd, "siteId"));
  if (!site) back(path, "Choose a site you have access to.");
  if (site.partnerId !== a.custodianPartnerId) back(path, "That site belongs to a different custodian. Moving a mold to another company needs a transfer (Phase 3b) or a custody correction by an administrator.");
  const after = await db.asset.update({ where: { id: a.id }, data: { siteId: site.id, locationDetail: str(fd, "locationDetail") } });
  await audit(ctx, { action: "moved", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { siteId: a.siteId, locationDetail: a.locationDetail }, after: { siteId: after.siteId, locationDetail: after.locationDetail }, reason: str(fd, "reason") });
  back(path, "Location updated.", "ok");
}

/** Administrative correction of custody (e.g. data migration errors). Requires a reason and elevated rights. */
export async function correctCustodyAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "delete");
  const a = await ownAsset(ctx, str(fd, "id"));
  await assertNotInTransfer(a.id);
  const path = `/assets/${a.id}`;
  const reason = str(fd, "reason");
  if (reason.length < 10) back(path, "Explain the correction (at least 10 characters). It is kept in the audit log.");
  const site = await db.site.findFirst({ where: { id: str(fd, "siteId"), orgId: ctx.org.id, active: true } });
  if (!site) back(path, "Choose a site.");
  const after = await db.asset.update({ where: { id: a.id }, data: { siteId: site.id, custodianPartnerId: site.partnerId, locationDetail: str(fd, "locationDetail") } });
  await audit(ctx, { action: "custody_corrected", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { siteId: a.siteId, custodianPartnerId: a.custodianPartnerId }, after: { siteId: after.siteId, custodianPartnerId: after.custodianPartnerId }, reason });
  back(path, "Custody corrected and logged.", "ok");
}

export async function setStatusAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const status = str(fd, "status");
  if (!MANUAL_STATUSES.includes(status)) back(`/assets/${a.id}`, "That status is set by a workflow, not manually.");
  if (a.status === "in_transfer") back(`/assets/${a.id}`, "The asset is in a transfer.");
  const reason = str(fd, "reason");
  if (["quarantined", "scrapped", "retired"].includes(status) && !reason) back(`/assets/${a.id}`, `Give a reason for setting the status to ${ASSET_STATUS[status as keyof typeof ASSET_STATUS]}.`);
  await db.asset.update({ where: { id: a.id }, data: { status } });
  await audit(ctx, { action: "status_changed", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { status: a.status }, after: { status }, reason });
  back(`/assets/${a.id}`, "Status updated.", "ok");
}

export async function deleteAssetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "delete");
  const a = await ownAsset(ctx, str(fd, "id"));
  await assertNotInTransfer(a.id);
  const reason = str(fd, "reason");
  if (!reason) back(`/assets/${a.id}`, "Give a reason for deleting.");
  await db.asset.update({ where: { id: a.id }, data: { deletedAt: new Date(), number: `${a.number}~deleted~${Date.now()}` } });
  await db.asset.updateMany({ where: { parentId: a.id }, data: { parentId: null } });
  await audit(ctx, { action: "deleted", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: a, reason });
  back("/assets", `${a.number} deleted.`, "ok");
}

// ─── Components, cavities, products ─────────────────────────────────────────

export async function attachComponentAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const parent = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${parent.id}?tab=components`;
  const child = await db.asset.findFirst({ where: { orgId: ctx.org.id, deletedAt: null, number: str(fd, "childNumber") } });
  if (!child) back(path, "No asset with that number.");
  if (child.id === parent.id) back(path, "An asset cannot be its own component.");
  for (let p: string | null = parent.parentId; p; ) {
    if (p === child.id) back(path, "That would create a loop in the component hierarchy.");
    p = (await db.asset.findUnique({ where: { id: p }, select: { parentId: true } }))?.parentId ?? null;
  }
  const role = (COMPONENT_ROLES as readonly string[]).includes(str(fd, "componentRole")) ? str(fd, "componentRole") : "other";
  await db.asset.update({ where: { id: child.id }, data: { parentId: parent.id, componentRole: role } });
  await audit(ctx, { action: "component_attached", entityType: "asset", entityId: parent.id, entityLabel: `${parent.number} ${parent.name}`, after: { component: child.number, role } });
  back(path, `${child.number} attached.`, "ok");
}

export async function detachComponentAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const parent = await ownAsset(ctx, str(fd, "id"));
  const child = await db.asset.findFirst({ where: { id: str(fd, "childId"), parentId: parent.id } });
  if (child) {
    await db.asset.update({ where: { id: child.id }, data: { parentId: null, componentRole: "" } });
    await audit(ctx, { action: "component_detached", entityType: "asset", entityId: parent.id, entityLabel: `${parent.number} ${parent.name}`, before: { component: child.number } });
  }
  back(`/assets/${parent.id}?tab=components`, "Component detached.", "ok");
}

export async function generateCavitiesAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${a.id}?tab=components`;
  const n = parseInt(str(fd, "count"), 10);
  if (!Number.isInteger(n) || n < 1 || n > 256) back(path, "Enter between 1 and 256 cavities.");
  const prefix = str(fd, "prefix").slice(0, 10);
  const existing = await db.cavity.count({ where: { assetId: a.id } });
  if (existing) back(path, "Cavities already exist. Add or block them individually.");
  await db.cavity.createMany({ data: Array.from({ length: n }, (_, i) => ({ assetId: a.id, identifier: `${prefix}${i + 1}` })) });
  if (!a.designCavities) await db.asset.update({ where: { id: a.id }, data: { designCavities: n } });
  await audit(ctx, { action: "cavities_created", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { cavities: n } });
  back(path, `${n} cavities created.`, "ok");
}

export async function setCavityAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${a.id}?tab=components`;
  const c = await db.cavity.findFirst({ where: { id: str(fd, "cavityId"), assetId: a.id } });
  if (!c) back(path, "Cavity not found.");
  const block = str(fd, "block") === "1";
  const reason = str(fd, "reason");
  if (block && !reason) back(path, "Give a reason for blocking the cavity.");
  await db.cavity.update({ where: { id: c.id }, data: { status: block ? "blocked" : "active", blockedReason: block ? reason : "" } });
  await audit(ctx, { action: block ? "cavity_blocked" : "cavity_unblocked", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { cavity: c.identifier }, reason });
  back(path, `Cavity ${c.identifier} ${block ? "blocked" : "re-activated"}.`, "ok");
}

export async function addProductAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${a.id}?tab=components`;
  const partNumber = str(fd, "partNumber");
  if (!partNumber) back(path, "Part number is required.");
  if (await db.assetProduct.findFirst({ where: { assetId: a.id, partNumber } })) back(path, "That part is already listed.");
  const cav = parseInt(str(fd, "cavitiesUsed"), 10);
  await db.assetProduct.create({ data: { assetId: a.id, partNumber, partName: str(fd, "partName"), customer: str(fd, "customer"), cavitiesUsed: Number.isInteger(cav) && cav > 0 ? cav : null } });
  await audit(ctx, { action: "product_added", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { partNumber } });
  back(path, "Product added.", "ok");
}

export async function removeProductAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "assets", "edit");
  const a = await ownAsset(ctx, str(fd, "id"));
  const p = await db.assetProduct.findFirst({ where: { id: str(fd, "productId"), assetId: a.id } });
  if (p) {
    await db.assetProduct.delete({ where: { id: p.id } });
    await audit(ctx, { action: "product_removed", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { partNumber: p.partNumber } });
  }
  back(`/assets/${a.id}?tab=components`, "Product removed.", "ok");
}

// ─── Documents ──────────────────────────────────────────────────────────────

export async function uploadDocumentAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "documents", "create");
  const a = await ownAsset(ctx, str(fd, "id"));
  const path = `/assets/${a.id}?tab=documents`;
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back(path, "Choose a file.");
  if (file.size > MAX_UPLOAD_BYTES) back(path, "Files must be 25 MB or smaller.");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.test(mime)) back(path, `File type ${mime} is not allowed. Use PDF, images, Office files, CSV, ZIP or 3D models.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await putFile(ctx.org.id, bytes);
  const docId = str(fd, "documentId");
  const result = await db.$transaction(async (tx) => {
    let doc = docId ? await tx.document.findFirst({ where: { id: docId, assetId: a.id } }) : null;
    if (docId && !doc) throw new Error("Document not found");
    if (!doc) {
      const cat = str(fd, "category");
      doc = await tx.document.create({ data: { assetId: a.id, title: str(fd, "title") || file.name, category: cat in DOC_CATEGORIES ? cat : "other" } });
    }
    const last = await tx.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: "desc" } });
    const v = await tx.documentVersion.create({
      data: { documentId: doc.id, version: (last?.version ?? 0) + 1, filename: file.name.slice(0, 200), mimeType: mime, sizeBytes: file.size, sha256: stored.sha256, storageKey: stored.key, note: str(fd, "note"), uploadedById: ctx.user.id },
    });
    await tx.document.update({ where: { id: doc.id }, data: { updatedAt: new Date() } });
    await audit(ctx, { action: v.version === 1 ? "document_added" : "document_version_added", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { document: doc.title, version: v.version, file: v.filename, sha256: v.sha256 } }, tx);
    return { doc, v };
  });
  back(path, `${result.doc.title} v${result.v.version} uploaded.`, "ok");
}

// ─── Shot readings ──────────────────────────────────────────────────────────

export async function addReadingAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "readings", "create");
  const a = await ownAsset(ctx, str(fd, "id"));
  const ret = str(fd, "return") || `/assets/${a.id}?tab=counter`;
  const meter = await db.meter.findFirst({ where: { assetId: a.id, kind: "shots" } });
  if (!meter) back(ret, "This asset has no shot counter.");
  const raw = str(fd, "value").replace(/,/g, "");
  const when = str(fd, "readAt");
  const readAt = when ? localInputToDate(when, ctx.org.timezone) : new Date();
  let msg = "";
  try {
    await db.$transaction(async (tx) => {
      const r = await recordReading(tx, meter, {
        rawValue: Number(raw),
        readAt,
        source: "manual",
        isReset: str(fd, "isReset") === "on",
        resetReason: str(fd, "resetReason"),
        note: str(fd, "note"),
        enteredById: ctx.user.id,
        confirmHigh: str(fd, "confirmHigh") === "on",
        cycleTimeS: a.designCycleTimeS,
      });
      await audit(ctx, { action: r.isReset ? "counter_reset" : "reading_recorded", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { raw: r.rawValue, lifetime: r.lifetime, delta: r.delta, readAt: r.readAt }, reason: r.resetReason }, tx);
    });
  } catch (e) {
    if (!(e instanceof ReadingError)) throw e;
    msg = e.message + (e.code === "implausible" ? " [confirm]" : "");
  }
  if (msg) back(ret, msg);
  back(ret, "Reading saved.", "ok");
}
