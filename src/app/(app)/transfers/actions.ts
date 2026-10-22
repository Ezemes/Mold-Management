"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { recordReading, ReadingError } from "@/lib/meters";
import { notify, recipientsFor, emailPending } from "@/lib/notify";
import { AttachmentError, saveAttachments, storeUploads } from "@/lib/attachments";
import { localInputToDate } from "@/lib/format";
import { parseDate } from "@/lib/asset-values";
import {
  actsFor,
  canTransition,
  HANDOVER_CHECKLIST,
  needsApproval,
  nextTransferNumber,
  openTransferFor,
  reconcileHandovers,
  TRANSFER_REASONS,
  transferScope,
  emitTransferStatus,
  type HandoverCheck,
  type TransferEvent,
} from "@/lib/transfers";
import { nextWorkOrderNumber } from "@/lib/work-orders";
import { afterReadings } from "@/lib/maintenance";
import { flagRequalification } from "@/lib/quality";
import { str } from "@/lib/forms";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

async function loadTransfer(ctx: Ctx, id: string) {
  const t = await db.transfer.findFirst({
    where: { AND: [transferScope(ctx), { id }] },
    include: { fromSite: true, toSite: true, items: { include: { asset: { include: { meters: true, assetType: true } }, handovers: true, disputes: true } } },
  });
  if (!t) back("/transfers", "Transfer not found or not in your scope.");
  return t;
}

function guard(t: { status: string; id: string }, event: TransferEvent) {
  if (!canTransition(t.status, event)) back(`/transfers/${t.id}`, `This transfer is ${t.status.replace("_", " ")}; that step is not available.`);
}

const label = (t: { number: string }) => t.number;

// ─── Create & submit ────────────────────────────────────────────────────────

export async function createTransferAction(fd: FormData) {
  await createTransfer(fd, false);
}

export async function createAndSubmitTransferAction(fd: FormData) {
  await createTransfer(fd, true);
}

async function createTransfer(fd: FormData, andSubmit: boolean) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "create");
  const numbers = [...new Set(str(fd, "assets").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  const ret = `/transfers/new?assets=${encodeURIComponent(numbers.join(","))}`;
  if (!numbers.length) back(ret, "Add at least one asset number.");
  if (numbers.length > 200) back(ret, "A transfer can move at most 200 assets.");
  const assets = await db.asset.findMany({ where: { AND: [assetScope(ctx), { number: { in: numbers, mode: "insensitive" } }] }, include: { site: true } });
  const missing = numbers.filter((n) => !assets.some((a) => a.number.toLowerCase() === n.toLowerCase()));
  if (missing.length) back(ret, `Not found or not in your scope: ${missing.join(", ")}`);
  const fromSiteIds = [...new Set(assets.map((a) => a.siteId))];
  if (fromSiteIds.length > 1) back(ret, "All assets in one transfer must be at the same site. Create one transfer per origin site.");
  const blocked = assets.filter((a) => a.status !== "active" && a.status !== "in_maintenance");
  if (blocked.length) back(ret, `Only active assets can be transferred: ${blocked.map((a) => `${a.number} (${a.status.replace("_", " ")})`).join(", ")}`);
  const open = await openTransferFor(assets.map((a) => a.id));
  if (open) back(ret, `${open.asset.number} is already in open transfer ${open.transfer.number}.`);
  const from = assets[0].site;
  if (!actsFor(ctx, from) && !ctx.can("transfers", "approve")) back(ret, "You can only request transfers for assets held at your sites.");
  const toSite = await db.site.findFirst({ where: { id: str(fd, "toSiteId"), orgId: ctx.org.id, active: true } });
  if (!toSite) back(ret, "Choose a destination site.");
  if (toSite.id === from.id) back(ret, "Destination is the same as the current site. Use “Move” on the passport for moves within a site's company.");
  const reason = str(fd, "reason") in TRANSFER_REASONS ? str(fd, "reason") : "other";
  const needed = parseDate(str(fd, "neededBy"), "Needed by");
  if (!needed.ok) back(ret, needed.error);

  const t = await db.$transaction(async (tx) => {
    const number = await nextTransferNumber(tx, ctx.org.id);
    const t = await tx.transfer.create({
      data: {
        orgId: ctx.org.id, number, reason, fromSiteId: from.id, fromPartnerId: from.partnerId, toSiteId: toSite.id, toPartnerId: toSite.partnerId,
        toLocationDetail: str(fd, "toLocationDetail"), neededBy: needed.value, notes: str(fd, "notes"), createdById: ctx.user.id,
        items: { create: assets.map((a) => ({ assetId: a.id })) },
      },
    });
    await audit(ctx, { action: "created", entityType: "transfer", entityId: t.id, entityLabel: number, after: { from: from.name, to: toSite.name, assets: assets.map((a) => a.number), reason } }, tx);
    return t;
  });
  if (andSubmit) await submit(ctx, t.id);
  back(`/transfers/${t.id}`, `Transfer ${t.number} created${andSubmit ? " and submitted" : " as a draft"}.`, "ok");
}

async function submit(ctx: Ctx, id: string) {
  const t = await loadTransfer(ctx, id);
  guard(t, "submit");
  const approval = needsApproval(ctx.org.transferApproval, t.fromPartnerId, t.toPartnerId);
  await db.$transaction(async (tx) => {
    await tx.transfer.update({ where: { id: t.id }, data: { status: approval ? "requested" : "approved", requestedById: ctx.user.id, requestedAt: new Date(), ...(approval ? {} : { approvedAt: new Date() }) } });
    await audit(ctx, { action: approval ? "submitted" : "submitted_auto_approved", entityType: "transfer", entityId: t.id, entityLabel: label(t) }, tx);
  });
  await emitTransferStatus(t.id);
  const link = `/transfers/${t.id}`;
  if (approval) {
    await notify(ctx.org.id, await recipientsFor(ctx.org.id, "transfers", "approve", { siteId: t.fromSiteId }), { kind: "transfer_approval", title: `Approve transfer ${t.number}`, body: `${t.items.length} asset(s) from ${t.fromSite.name} to ${t.toSite.name}.`, link }, { exceptUserId: ctx.user.id });
  } else {
    await notify(ctx.org.id, await recipientsFor(ctx.org.id, "transfers", "edit", { siteId: t.fromSiteId, partnerIds: [t.fromPartnerId] }), { kind: "transfer_ship", title: `Ship transfer ${t.number}`, body: `Prepare ${t.items.length} asset(s) for dispatch to ${t.toSite.name}.`, link }, { exceptUserId: ctx.user.id });
  }
}

export async function submitTransferAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "create");
  await submit(ctx, str(fd, "id"));
  back(`/transfers/${str(fd, "id")}`, "Submitted.", "ok");
}

export async function approveTransferAction(fd: FormData) {
  await decide(fd, true);
}

export async function rejectTransferAction(fd: FormData) {
  await decide(fd, false);
}

async function decide(fd: FormData, approve: boolean) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "approve");
  if (ctx.isSupplier) back("/transfers", "Approvals are made by the organisation.");
  const t = await loadTransfer(ctx, str(fd, "id"));
  guard(t, approve ? "approve" : "reject");
  const reason = str(fd, "reason");
  if (!approve && !reason) back(`/transfers/${t.id}`, "Give a reason for rejecting.");
  await db.$transaction(async (tx) => {
    await tx.transfer.update({ where: { id: t.id }, data: approve ? { status: "approved", approvedById: ctx.user.id, approvedAt: new Date() } : { status: "rejected", rejectionReason: reason } });
    await audit(ctx, { action: approve ? "approved" : "rejected", entityType: "transfer", entityId: t.id, entityLabel: label(t), reason }, tx);
  });
  const link = `/transfers/${t.id}`;
  if (approve) await notify(ctx.org.id, await recipientsFor(ctx.org.id, "transfers", "edit", { siteId: t.fromSiteId, partnerIds: [t.fromPartnerId] }), { kind: "transfer_ship", title: `Ship transfer ${t.number}`, body: `Approved. Prepare ${t.items.length} asset(s) for dispatch to ${t.toSite.name}.`, link }, { exceptUserId: ctx.user.id });
  if (t.createdById && t.createdById !== ctx.user.id) await notify(ctx.org.id, [t.createdById], { kind: approve ? "transfer_approved" : "transfer_rejected", title: `Transfer ${t.number} ${approve ? "approved" : "rejected"}`, body: reason, link });
  await emitTransferStatus(t.id);
  back(link, approve ? "Approved." : "Rejected.", "ok");
}

export async function cancelTransferAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "create");
  const t = await loadTransfer(ctx, str(fd, "id"));
  guard(t, "cancel");
  const reason = str(fd, "reason");
  if (!reason) back(`/transfers/${t.id}`, "Give a reason for cancelling.");
  await db.$transaction(async (tx) => {
    await tx.transfer.update({ where: { id: t.id }, data: { status: "cancelled", cancelledReason: reason } });
    await audit(ctx, { action: "cancelled", entityType: "transfer", entityId: t.id, entityLabel: label(t), reason }, tx);
  });
  await emitTransferStatus(t.id);
  back(`/transfers/${t.id}`, "Transfer cancelled.", "ok");
}

// ─── Handovers ──────────────────────────────────────────────────────────────

function readChecklist(fd: FormData, itemId: string): HandoverCheck[] {
  return HANDOVER_CHECKLIST.map((c) => ({ ...c, ok: fd.get(`${itemId}.check.${c.key}`) !== "fail", note: str(fd, `${itemId}.note.${c.key}`) }));
}

function readShots(fd: FormData, itemId: string, hasMeter: boolean, path: string) {
  const raw = str(fd, `${itemId}.shots`).replace(/,/g, "");
  if (!hasMeter) return null;
  if (!/^\d+$/.test(raw)) back(path, "Enter the shot counter value for every mold with a counter.");
  return Number(raw);
}

export async function shipTransferAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "edit");
  const t = await loadTransfer(ctx, str(fd, "id"));
  const path = `/transfers/${t.id}`;
  guard(t, "ship");
  if (!actsFor(ctx, t.fromSite)) back(path, `Only ${t.fromSite.name} can record the dispatch.`);
  const eta = str(fd, "eta") ? parseDate(str(fd, "eta"), "ETA") : ({ ok: true, value: null } as const);
  if (!eta.ok) back(path, eta.error);
  let files: Record<string, Awaited<ReturnType<typeof storeUploads>>> = {};
  let error = "";
  try {
    for (const it of t.items) files[it.id] = await storeUploads(ctx.org.id, fd.getAll(`${it.id}.photos`));
  } catch (e) {
    if (!(e instanceof AttachmentError)) throw e;
    error = e.message;
    files = {};
  }
  if (error) back(path, error);
  const shippedAt = str(fd, "shippedAt") ? localInputToDate(str(fd, "shippedAt"), ctx.org.timezone) : new Date();
  const shotsBy = Object.fromEntries(t.items.map((it) => [it.id, readShots(fd, it.id, it.asset.meters.some((m) => m.kind === "shots"), path)]));
  try {
    await db.$transaction(async (tx) => {
      for (const it of t.items) {
        const meter = it.asset.meters.find((m) => m.kind === "shots");
        const shots = shotsBy[it.id];
        let lifetime: number | null = null;
        if (meter && shots != null) {
          const r = await recordReading(tx, meter, { rawValue: shots, readAt: shippedAt, source: "handover", note: `Dispatch ${t.number}`, enteredById: ctx.user.id, confirmHigh: true });
          lifetime = r.lifetime;
        }
        const checklist = readChecklist(fd, it.id);
        const h = await tx.handover.create({
          data: { itemId: it.id, direction: "outbound", shotReading: shots, lifetimeShots: lifetime, checklist: checklist as unknown as Prisma.InputJsonValue, conditionOk: checklist.every((c) => c.ok), accessories: str(fd, `${it.id}.accessories`), notes: str(fd, `${it.id}.notes`), byUserId: ctx.user.id, at: shippedAt },
        });
        await saveAttachments(tx, ctx.org.id, "handover", h.id, files[it.id] ?? [], ctx.user.id);
        await tx.transferItem.update({ where: { id: it.id }, data: { status: "shipped" } });
        await tx.asset.update({ where: { id: it.assetId }, data: { status: "in_transfer" } });
        await audit(ctx, { action: "dispatched", entityType: "asset", entityId: it.assetId, entityLabel: `${it.asset.number} ${it.asset.name}`, after: { transfer: t.number, shots, lifetime, to: t.toSite.name } }, tx);
      }
      await tx.transfer.update({
        where: { id: t.id },
        data: { status: "in_transit", shippedAt, shippedById: ctx.user.id, carrier: str(fd, "carrier"), trackingNumber: str(fd, "trackingNumber"), vehicleNumber: str(fd, "vehicleNumber").toUpperCase(), ewayBillNumber: str(fd, "ewayBillNumber"), eta: eta.value },
      });
      await audit(ctx, { action: "shipped", entityType: "transfer", entityId: t.id, entityLabel: label(t), after: { carrier: str(fd, "carrier"), tracking: str(fd, "trackingNumber"), vehicle: str(fd, "vehicleNumber") } }, tx);
    });
  } catch (e) {
    if (!(e instanceof ReadingError)) throw e;
    error = `${e.message} Correct the counter on the asset first if it was reset.`;
  }
  if (error) back(path, error);
  await afterReadings(ctx.org.id, t.items.map((it) => it.assetId));
  await notify(ctx.org.id, await recipientsFor(ctx.org.id, "transfers", "edit", { siteId: t.toSiteId, partnerIds: [t.toPartnerId] }), { kind: "transfer_receive", title: `Incoming transfer ${t.number}`, body: `${t.items.length} asset(s) dispatched from ${t.fromSite.name}. Record receipt when they arrive.`, link: path }, { exceptUserId: ctx.user.id });
  await emitTransferStatus(t.id);
  back(path, "Dispatch recorded. The sender stays responsible until the receiver confirms receipt.", "ok");
}

export async function receiveTransferAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "edit");
  const t = await loadTransfer(ctx, str(fd, "id"));
  const path = `/transfers/${t.id}`;
  guard(t, "receive");
  if (!actsFor(ctx, t.toSite)) back(path, `Only ${t.toSite.name} can confirm receipt.`);
  const files: Record<string, Awaited<ReturnType<typeof storeUploads>>> = {};
  let error = "";
  try {
    for (const it of t.items) files[it.id] = await storeUploads(ctx.org.id, fd.getAll(`${it.id}.photos`));
  } catch (e) {
    if (!(e instanceof AttachmentError)) throw e;
    error = e.message;
  }
  if (error) back(path, error);
  for (const it of t.items) if (fd.get(`${it.id}.tagVerified`) !== "on") back(path, `Confirm the tag on ${it.asset.number} matches (scan or check the number).`);
  const receivedAt = str(fd, "receivedAt") ? localInputToDate(str(fd, "receivedAt"), ctx.org.timezone) : new Date();
  if (t.shippedAt && receivedAt < t.shippedAt) back(path, "Receipt time is before the dispatch time.");
  const shotsBy = Object.fromEntries(t.items.map((it) => [it.id, readShots(fd, it.id, it.asset.meters.some((m) => m.kind === "shots"), path)]));

  let disputes = 0;
  try {
    await db.$transaction(async (tx) => {
      for (const it of t.items) {
        const meter = it.asset.meters.find((m) => m.kind === "shots");
        const shots = shotsBy[it.id];
        let lifetime: number | null = null;
        let backwards = false;
        if (meter && shots != null) {
          const fresh = await tx.meter.findUniqueOrThrow({ where: { id: meter.id } });
          if (fresh.lastRawValue != null && shots < fresh.lastRawValue) {
            backwards = true; // not recorded on the meter; raised as a dispute instead
            lifetime = shots + fresh.offset;
          } else {
            const r = await recordReading(tx, fresh, { rawValue: shots, readAt: receivedAt, source: "handover", note: `Receipt ${t.number}`, enteredById: ctx.user.id, confirmHigh: true });
            lifetime = r.lifetime;
          }
        }
        const checklist = readChecklist(fd, it.id);
        const conditionOk = fd.get(`${it.id}.conditionOk`) !== "no" && checklist.every((c) => c.ok);
        const accessoriesComplete = fd.get(`${it.id}.accessoriesComplete`) !== "no";
        const h = await tx.handover.create({
          data: { itemId: it.id, direction: "inbound", shotReading: shots, lifetimeShots: lifetime, checklist: checklist as unknown as Prisma.InputJsonValue, conditionOk, accessories: accessoriesComplete ? "complete" : "incomplete", notes: str(fd, `${it.id}.notes`), tagVerified: true, byUserId: ctx.user.id, at: receivedAt },
        });
        await saveAttachments(tx, ctx.org.id, "handover", h.id, files[it.id] ?? [], ctx.user.id);
        const out = it.handovers.find((x) => x.direction === "outbound");
        const findings = reconcileHandovers(
          { lifetimeShots: out?.lifetimeShots ?? null, conditionOk: out?.conditionOk ?? true, checklist: (out?.checklist ?? []) as unknown as HandoverCheck[], accessories: out?.accessories ?? "" },
          { lifetimeShots: lifetime, conditionOk, checklist, accessoriesComplete },
          ctx.org.transferShotTolerance,
        );
        if (backwards && !findings.some((f) => f.kind === "shot_mismatch")) findings.unshift({ kind: "shot_mismatch", detail: "Counter at receipt is lower than at dispatch." });
        for (const f of findings) {
          await tx.dispute.create({ data: { itemId: it.id, kind: f.kind, detail: f.detail, outboundShots: out?.lifetimeShots ?? null, inboundShots: lifetime } });
        }
        disputes += findings.length;
        // Decision D3: custody passes to the receiver when receipt is confirmed.
        await tx.asset.update({ where: { id: it.assetId }, data: { siteId: t.toSiteId, custodianPartnerId: t.toPartnerId, locationDetail: t.toLocationDetail, status: "active" } });
        await tx.transferItem.update({ where: { id: it.id }, data: { status: findings.length ? "disputed" : "accepted" } });
        if (ctx.org.requalifyOnTransfer && it.asset.assetType.kind === "mold" && t.toSiteId !== t.fromSiteId) {
          await flagRequalification(tx, { orgId: ctx.org.id, userId: ctx.user.id }, it.asset, `Moved to ${t.toSite.name} by ${t.number}`);
        }
        await audit(ctx, { action: "custody_transferred", entityType: "asset", entityId: it.assetId, entityLabel: `${it.asset.number} ${it.asset.name}`, before: { siteId: t.fromSiteId, custodianPartnerId: t.fromPartnerId }, after: { siteId: t.toSiteId, custodianPartnerId: t.toPartnerId, transfer: t.number, shots, disputes: findings.map((f) => f.kind) } }, tx);
      }
      await tx.transfer.update({ where: { id: t.id }, data: { status: disputes ? "disputed" : "completed", receivedAt, receivedById: ctx.user.id, ...(disputes ? {} : { completedAt: new Date() }) } });
      await audit(ctx, { action: disputes ? "received_with_dispute" : "received", entityType: "transfer", entityId: t.id, entityLabel: label(t), after: { disputes } }, tx);
    });
  } catch (e) {
    if (!(e instanceof ReadingError)) throw e;
    error = e.message;
  }
  if (error) back(path, error);
  await afterReadings(ctx.org.id, t.items.map((it) => it.assetId));
  const watchers = [t.createdById, t.requestedById, t.approvedById].filter((x): x is string => !!x);
  if (disputes) {
    const approvers = await recipientsFor(ctx.org.id, "transfers", "approve", { siteId: t.fromSiteId });
    await notify(ctx.org.id, [...approvers, ...watchers], { kind: "transfer_dispute", title: `Dispute on transfer ${t.number}`, body: `${disputes} issue(s) found at receipt in ${t.toSite.name}.`, link: path }, { exceptUserId: ctx.user.id });
  } else {
    await notify(ctx.org.id, watchers, { kind: "transfer_completed", title: `Transfer ${t.number} received`, body: `All assets accepted at ${t.toSite.name}.`, link: path }, { exceptUserId: ctx.user.id });
  }
  await emitTransferStatus(t.id);
  back(path, disputes ? `Receipt recorded with ${disputes} dispute(s). Custody has passed to ${t.toSite.name}.` : "Receipt recorded. Custody has passed to the receiver and the transfer is complete.", disputes ? "error" : "ok");
}

export async function resolveDisputeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "transfers", "approve");
  if (ctx.isSupplier) back("/transfers", "Disputes are resolved by the organisation.");
  const d = await db.dispute.findFirst({ where: { id: str(fd, "disputeId"), status: "open", item: { transfer: transferScope(ctx) } }, include: { item: { include: { transfer: true, asset: true } } } });
  if (!d) back("/transfers", "Dispute not found.");
  const t = d.item.transfer;
  const path = `/transfers/${t.id}`;
  const resolution = str(fd, "resolution");
  if (resolution.length < 5) back(path, "Describe how the dispute was resolved.");
  await db.$transaction(async (tx) => {
    let workOrderId: string | null = null;
    if (str(fd, "createWorkOrder") === "on") {
      const number = await nextWorkOrderNumber(tx, ctx.org.id);
      const wo = await tx.workOrder.create({ data: { orgId: ctx.org.id, number, assetId: d.item.assetId, type: "corrective", title: `Transfer ${t.number}: ${d.kind.replace("_", " ")}`, description: d.detail, priority: "high", source: "dispute", sourceId: d.id, createdById: ctx.user.id, dueDate: new Date(Date.now() + 7 * 86_400_000) } });
      workOrderId = wo.id;
      await audit(ctx, { action: "created", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: d.item.asset.number, from: `dispute on ${t.number}` } }, tx);
    }
    await tx.dispute.update({ where: { id: d.id }, data: { status: "resolved", resolution, resolvedById: ctx.user.id, resolvedAt: new Date(), workOrderId } });
    const remaining = await tx.dispute.count({ where: { itemId: d.itemId, status: "open" } });
    if (!remaining) await tx.transferItem.update({ where: { id: d.itemId }, data: { status: "resolved" } });
    const openInTransfer = await tx.dispute.count({ where: { status: "open", item: { transferId: t.id } } });
    if (!openInTransfer) await tx.transfer.update({ where: { id: t.id }, data: { status: "completed", completedAt: new Date() } });
    await audit(ctx, { action: "dispute_resolved", entityType: "transfer", entityId: t.id, entityLabel: t.number, after: { asset: d.item.asset.number, kind: d.kind, workOrderId }, reason: resolution }, tx);
  });
  await emailPending();
  await emitTransferStatus(t.id);
  back(path, "Dispute resolved.", "ok");
}
