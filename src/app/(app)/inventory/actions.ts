"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, siteScope, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseDate } from "@/lib/asset-values";
import { str } from "@/lib/forms";
import { moveStock, parseQty, StockError } from "@/lib/inventory";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

async function scopedSite(ctx: Ctx, siteId: string, path: string) {
  const site = await db.site.findFirst({ where: { AND: [siteScope(ctx), { id: siteId, active: true }] } });
  if (!site) back(path, "Choose a site in your scope.");
  return site;
}

async function loadPart(ctx: Ctx, id: string) {
  const p = await db.part.findFirst({ where: { id, orgId: ctx.org.id } });
  if (!p) back("/inventory", "Part not found.");
  return p;
}

/** Run stock changes in one transaction, turning a shortage into a message instead of an error page. */
async function stockTx(path: string, fn: Parameters<typeof db.$transaction>[0]) {
  let error = "";
  try {
    await db.$transaction(fn);
  } catch (e) {
    if (!(e instanceof StockError)) throw e;
    error = e.message;
  }
  if (error) back(path, error);
}

export async function savePartAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "inventory", id ? "edit" : "create");
  const ret = id ? `/inventory/parts/${id}` : "/inventory?new=1";
  const number = str(fd, "number").toUpperCase();
  const name = str(fd, "name");
  if (!number || !name) back(ret, "Part number and name are required.");
  const levels: Record<string, number> = {};
  for (const k of ["minQty", "maxQty", "reorderPoint", "unitCost"]) {
    const v = parseQty(str(fd, k) || "0", { allowZero: true });
    if (v == null) back(ret, "Quantities and cost must be zero or positive numbers.");
    levels[k] = v;
  }
  if (levels.maxQty && levels.maxQty < levels.minQty) back(ret, "Max quantity must be at least the min quantity.");
  const shelf = str(fd, "shelfLifeDays") ? Number(str(fd, "shelfLifeDays")) : null;
  if (shelf != null && (!Number.isInteger(shelf) || shelf < 1 || shelf > 36500)) back(ret, "Shelf life must be a whole number of days.");
  const dup = await db.part.findFirst({ where: { orgId: ctx.org.id, number, NOT: id ? { id } : undefined } });
  if (dup) back(ret, `Part number ${number} already exists.`);
  const numbers = [...new Set(str(fd, "assets").split(/[\s,;]+/).filter(Boolean))];
  const assets = numbers.length ? await db.asset.findMany({ where: { AND: [assetScope(ctx), { number: { in: numbers, mode: "insensitive" } }] }, select: { id: true, number: true } }) : [];
  const missing = numbers.filter((n) => !assets.some((a) => a.number.toLowerCase() === n.toLowerCase()));
  if (missing.length) back(ret, `Assets not found: ${missing.join(", ")}`);
  const data = { number, name, manufacturer: str(fd, "manufacturer"), mfrPartNumber: str(fd, "mfrPartNumber"), category: str(fd, "category"), unit: str(fd, "unit") || "pcs", shelfLifeDays: shelf, ...levels };
  const before = id ? await loadPart(ctx, id) : null;
  const part = await db.$transaction(async (tx) => {
    const p = id ? await tx.part.update({ where: { id }, data }) : await tx.part.create({ data: { ...data, orgId: ctx.org.id } });
    await tx.partAsset.deleteMany({ where: { partId: p.id } });
    if (assets.length) await tx.partAsset.createMany({ data: assets.map((a) => ({ partId: p.id, assetId: a.id })) });
    await audit(ctx, { action: id ? "updated" : "created", entityType: "part", entityId: p.id, entityLabel: `${number} ${name}`, before: before ?? undefined, after: { ...data, assets: assets.map((a) => a.number) } }, tx);
    return p;
  });
  back(`/inventory/parts/${part.id}`, `Part ${number} saved.`, "ok");
}

export async function receiveStockAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory", "edit");
  const p = await loadPart(ctx, str(fd, "partId"));
  const path = `/inventory/parts/${p.id}`;
  const site = await scopedSite(ctx, str(fd, "siteId"), path);
  const qty = parseQty(str(fd, "quantity"));
  if (qty == null) back(path, "Enter a quantity above zero.");
  const cost = str(fd, "unitCost") ? parseQty(str(fd, "unitCost"), { allowZero: true }) : Number(p.unitCost);
  if (cost == null) back(path, "Unit cost must be zero or positive.");
  const exp = str(fd, "expiresAt") ? parseDate(str(fd, "expiresAt"), "Expiry date") : ({ ok: true, value: p.shelfLifeDays ? new Date(Date.now() + p.shelfLifeDays * 86_400_000) : null } as const);
  if (!exp.ok) back(path, exp.error);
  await stockTx(path, async (tx) => {
    await moveStock(tx, { orgId: ctx.org.id, partId: p.id, siteId: site.id, kind: "receipt", quantity: qty, unitCost: cost, reference: str(fd, "reference"), note: str(fd, "note"), userId: ctx.user.id, expiresAt: exp.value });
    if (str(fd, "bin")) await tx.stock.update({ where: { partId_siteId: { partId: p.id, siteId: site.id } }, data: { bin: str(fd, "bin") } });
    // The catalogue cost follows the latest receipt.
    if (cost !== Number(p.unitCost)) await tx.part.update({ where: { id: p.id }, data: { unitCost: cost } });
  });
  back(path, `Received ${qty.toLocaleString("en-IN")} ${p.unit} at ${site.name}.`, "ok");
}

export async function adjustStockAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory", "edit");
  const p = await loadPart(ctx, str(fd, "partId"));
  const path = `/inventory/parts/${p.id}`;
  const site = await scopedSite(ctx, str(fd, "siteId"), path);
  const counted = parseQty(str(fd, "counted"), { allowZero: true });
  if (counted == null) back(path, "Enter the counted quantity.");
  const reason = str(fd, "reason");
  if (reason.length < 3) back(path, "Give a reason for the adjustment (e.g. cycle count, damaged).");
  const current = (await db.stock.findUnique({ where: { partId_siteId: { partId: p.id, siteId: site.id } } }))?.quantity ?? 0;
  const delta = Math.round((counted - current) * 1000) / 1000;
  if (delta === 0) back(path, "The count matches the stock on record; nothing to adjust.");
  await stockTx(path, async (tx) => {
    await moveStock(tx, { orgId: ctx.org.id, partId: p.id, siteId: site.id, kind: "adjustment", quantity: delta, note: reason, userId: ctx.user.id });
    await audit(ctx, { action: "stock_adjusted", entityType: "part", entityId: p.id, entityLabel: `${p.number} ${p.name}`, before: { quantity: current, site: site.name }, after: { quantity: counted }, reason }, tx);
  });
  back(path, `Stock at ${site.name} adjusted by ${delta > 0 ? "+" : ""}${delta.toLocaleString("en-IN")}.`, "ok");
}

export async function transferStockAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory", "edit");
  const p = await loadPart(ctx, str(fd, "partId"));
  const path = `/inventory/parts/${p.id}`;
  const from = await scopedSite(ctx, str(fd, "fromSiteId"), path);
  const to = await db.site.findFirst({ where: { id: str(fd, "toSiteId"), orgId: ctx.org.id, active: true } });
  if (!to) back(path, "Choose the receiving site.");
  if (to.id === from.id) back(path, "Choose a different receiving site.");
  const qty = parseQty(str(fd, "quantity"));
  if (qty == null) back(path, "Enter a quantity above zero.");
  const ref = str(fd, "reference");
  await stockTx(path, async (tx) => {
    await moveStock(tx, { orgId: ctx.org.id, partId: p.id, siteId: from.id, kind: "transfer_out", quantity: -qty, reference: ref, note: `To ${to.name}`, userId: ctx.user.id });
    await moveStock(tx, { orgId: ctx.org.id, partId: p.id, siteId: to.id, kind: "transfer_in", quantity: qty, reference: ref, note: `From ${from.name}`, userId: ctx.user.id });
  });
  back(path, `Moved ${qty.toLocaleString("en-IN")} ${p.unit} from ${from.name} to ${to.name}.`, "ok");
}

export async function setLevelsAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory", "edit");
  const p = await loadPart(ctx, str(fd, "partId"));
  const path = `/inventory/parts/${p.id}`;
  const site = await scopedSite(ctx, str(fd, "siteId"), path);
  const v = Object.fromEntries(["minQty", "maxQty", "reorderPoint"].map((k) => [k, parseQty(str(fd, k) || "0", { allowZero: true })]));
  if (Object.values(v).some((x) => x == null)) back(path, "Levels must be zero or positive numbers.");
  if (v.maxQty! && v.maxQty! < v.minQty!) back(path, "Max must be at least min.");
  await db.stock.upsert({
    where: { partId_siteId: { partId: p.id, siteId: site.id } },
    create: { partId: p.id, siteId: site.id, bin: str(fd, "bin"), minQty: v.minQty!, maxQty: v.maxQty!, reorderPoint: v.reorderPoint! },
    update: { bin: str(fd, "bin"), minQty: v.minQty!, maxQty: v.maxQty!, reorderPoint: v.reorderPoint! },
  });
  back(path, `Levels saved for ${site.name}.`, "ok");
}
