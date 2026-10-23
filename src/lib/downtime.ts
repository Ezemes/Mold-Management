import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { assetScope, type Ctx } from "./auth";
import { audit } from "./audit";
import { emitEvent } from "./webhooks";
import { DEFAULT_CODES, downtimeMetrics, durationHours, validateDowntime } from "./downtime.pure";

export * from "./downtime.pure";

/** Give an organisation the standard downtime codes the first time they are needed. */
export async function ensureCodes(orgId: string) {
  if (await db.downtimeCode.count({ where: { orgId } })) return;
  await db.downtimeCode.createMany({ data: DEFAULT_CODES.map((c, i) => ({ orgId, ...c, sortOrder: i })), skipDuplicates: true });
}

export async function downtimeCodes(orgId: string, activeOnly = true) {
  await ensureCodes(orgId);
  return db.downtimeCode.findMany({ where: { orgId, ...(activeOnly ? { active: true } : {}) }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { code: "asc" }] });
}

export async function nextDowntimeNumber(tx: Prisma.TransactionClient, orgId: string) {
  const last = await tx.downtimeEvent.findFirst({ where: { orgId }, orderBy: { number: "desc" }, select: { number: true } });
  const n = (parseInt(last?.number.replace(/^DT-/, "") ?? "0", 10) || 0) + 1;
  return `DT-${String(n).padStart(5, "0")}`;
}

/** Downtime a user may see: events on assets in their scope. */
export function downtimeScope(ctx: Ctx): Prisma.DowntimeEventWhereInput {
  return { orgId: ctx.org.id, asset: assetScope(ctx) };
}

/** The asset's other events, for overlap checks. */
export async function otherEvents(tx: Prisma.TransactionClient, assetId: string, exceptId?: string) {
  return tx.downtimeEvent.findMany({ where: { assetId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { number: true, startedAt: true, endedAt: true } });
}

/** MTBF, MTTR and availability for the assets in scope (optionally narrowed) over [start, end]. */
export async function loadMetrics(ctx: Ctx, start: Date, end: Date, where: Prisma.AssetWhereInput = {}, now = new Date()) {
  const assets = await db.asset.findMany({
    where: { AND: [assetScope(ctx), where, { parentId: null, assetType: { kind: "mold" }, status: { notIn: ["retired", "scrapped"] } }] },
    select: { id: true, number: true, name: true, createdAt: true, site: { select: { name: true } }, assetType: { select: { name: true } } },
    orderBy: { number: "asc" },
  });
  const events = await db.downtimeEvent.findMany({
    where: { assetId: { in: assets.map((a) => a.id) }, startedAt: { lte: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
    select: { assetId: true, category: true, codeId: true, startedAt: true, endedAt: true },
  });
  // Tracked from the passport's creation, or the earliest recorded downtime if history was imported.
  const first = await db.downtimeEvent.groupBy({ by: ["assetId"], where: { assetId: { in: assets.map((a) => a.id) } }, _min: { startedAt: true } });
  const firstOf = new Map(first.map((f) => [f.assetId, f._min.startedAt]));
  const trackedFrom = (a: { id: string; createdAt: Date }) => { const f = firstOf.get(a.id); return f && f < a.createdAt ? f : a.createdAt; };
  const m = downtimeMetrics(assets.map((a) => ({ id: a.id, trackedFrom: trackedFrom(a) })), events, start, end, now);
  return { ...m, assets, eventCount: events.length };
}

/** Completing a work order ends the open downtime linked to it. Call inside the completion transaction. */
export async function endLinkedDowntime(tx: Prisma.TransactionClient, ctx: { org: { id: string }; user: { id: string } }, workOrderId: string, at: Date, woNumber: string) {
  const open = await tx.downtimeEvent.findMany({ where: { workOrderId, endedAt: null, startedAt: { lt: at } }, include: { asset: { select: { number: true } } } });
  for (const e of open) {
    await tx.downtimeEvent.update({ where: { id: e.id }, data: { endedAt: at, endedById: ctx.user.id } });
    await audit(ctx, { action: "downtime_ended", entityType: "downtime", entityId: e.id, entityLabel: `${e.number} ${e.asset.number}`, after: { endedAt: at }, reason: `Work order ${woNumber} completed` }, tx);
  }
  return open.map((e) => e.id);
}

/** Emit downtime.started / downtime.ended once the change has committed. */
export async function emitDowntime(id: string, type: "downtime.started" | "downtime.ended") {
  const e = await db.downtimeEvent.findUnique({ where: { id }, include: downtimeInclude });
  if (!e) return;
  if (type === "downtime.ended" && !e.endedAt) return;
  await emitEvent(e.orgId, type, downtimeOut(e), { dedupeKey: `${type}:${e.id}` });
}

export const downtimeInclude = { asset: { select: { number: true } }, press: { select: { number: true } }, code: true, workOrder: { select: { number: true } } } as const;
type Full = Prisma.DowntimeEventGetPayload<{ include: typeof downtimeInclude }>;

/** The API and webhook shape of an event. */
export function downtimeOut(e: Full, now = new Date()) {
  return {
    id: e.id, number: e.number, asset: e.asset.number, press: e.press?.number ?? null, code: e.code.code, reason: e.code.name, category: e.category,
    started_at: e.startedAt.toISOString(), ended_at: e.endedAt?.toISOString() ?? null, open: !e.endedAt,
    duration_hours: Math.round(durationHours(e, now) * 100) / 100, description: e.description || null, work_order: e.workOrder?.number ?? null, source: e.source,
  };
}

export class DowntimeError extends Error {}

export type DowntimeInput = {
  assetId: string; assetNumber: string; codeId: string; category: string; startedAt: Date; endedAt: Date | null;
  description: string; pressId: string | null; workOrderId: string | null; source: "manual" | "import" | "api";
};

/** Record an event after checking it against the asset's other events. Throws DowntimeError when it doesn't fit. */
export async function createDowntime(tx: Prisma.TransactionClient, actor: { orgId: string; userId: string | null }, d: DowntimeInput, reason = "", now = new Date()) {
  const problem = validateDowntime(d, await otherEvents(tx, d.assetId), now);
  if (problem) throw new DowntimeError(problem);
  const number = await nextDowntimeNumber(tx, actor.orgId);
  const { assetNumber, ...data } = d;
  const e = await tx.downtimeEvent.create({ data: { ...data, orgId: actor.orgId, number, reportedById: actor.userId, endedById: d.endedAt ? actor.userId : null } });
  await audit(actor, { action: "downtime_recorded", entityType: "downtime", entityId: e.id, entityLabel: `${number} ${assetNumber}`, after: { asset: assetNumber, category: d.category, startedAt: d.startedAt, endedAt: d.endedAt, description: d.description }, reason }, tx);
  return e;
}
