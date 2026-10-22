import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { recordReading, ReadingError } from "./meters";
import { afterReadings } from "./maintenance";
import { reconcileReports } from "./reconcile";

type Who = { orgId: string; userId: string | null; label: string };
type Scope = { siteIds: string[] };
export type ItemResult = { index: number; asset: string | null; status: "created" | "duplicate" | "error"; code?: string; message?: string; [k: string]: unknown };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const date = (v: unknown) => { if (typeof v !== "string" || !v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };

async function findAsset(who: Who, scope: Scope, number: string) {
  return db.asset.findFirst({ where: { orgId: who.orgId, deletedAt: null, number: { equals: number, mode: "insensitive" }, ...(scope.siteIds.length ? { siteId: { in: scope.siteIds } } : {}) }, include: { meters: true } });
}

/**
 * Record shot readings. Each item is applied on its own, so one bad reading doesn't reject the rest.
 * Re-sending a reading already stored (same counter, time and value) is reported as a duplicate, which
 * makes retries from sensors and integrations safe.
 */
export async function ingestReadings(who: Who, scope: Scope, items: unknown[]): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  const touched = new Set<string>();
  for (const [index, raw] of items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const number = str(it.asset);
    const fail = (code: string, message: string) => results.push({ index, asset: number || null, status: "error", code, message });
    if (!number) { fail("invalid", "“asset” (asset number) is required."); continue; }
    if (typeof it.value !== "number" || !Number.isInteger(it.value) || it.value < 0) { fail("invalid", "“value” must be a non-negative whole number."); continue; }
    const readAt = it.read_at == null ? new Date() : date(it.read_at);
    if (!readAt) { fail("invalid", "“read_at” must be an ISO 8601 date-time."); continue; }
    const a = await findAsset(who, scope, number);
    if (!a) { fail("not_found", "Asset not found (or outside this key's sites)."); continue; }
    const meter = a.meters.find((m) => m.kind === "shots");
    if (!meter) { fail("no_counter", "This asset has no shot counter."); continue; }
    const dup = await db.meterReading.findFirst({ where: { meterId: meter.id, readAt, rawValue: it.value } });
    if (dup) { results.push({ index, asset: a.number, status: "duplicate", lifetime_shots: dup.lifetime, reading_id: dup.id }); continue; }
    try {
      const r = await db.$transaction(async (tx) => {
        const fresh = await tx.meter.findUniqueOrThrow({ where: { id: meter.id } });
        const r = await recordReading(tx, fresh, {
          rawValue: it.value as number, readAt, source: "api", isReset: it.is_reset === true, resetReason: str(it.reset_reason), note: str(it.note).slice(0, 500),
          enteredById: who.userId, confirmHigh: it.confirm_high === true, cycleTimeS: a.designCycleTimeS,
        });
        await audit({ orgId: who.orgId, userId: who.userId }, { action: r.isReset ? "counter_reset" : "reading_recorded", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { raw: r.rawValue, lifetime: r.lifetime, delta: r.delta, readAt: r.readAt }, reason: r.resetReason || who.label }, tx);
        return r;
      });
      touched.add(a.id);
      results.push({ index, asset: a.number, status: "created", lifetime_shots: r.lifetime, delta: r.delta, reading_id: r.id });
    } catch (e) {
      if (!(e instanceof ReadingError)) throw e;
      fail(e.code, e.message);
    }
  }
  if (touched.size) await afterReadings(who.orgId, [...touched]);
  return results;
}

/** Store production quantities and reconcile them against the shot counter. Re-sending a period updates it. */
export async function ingestProduction(who: Who, scope: Scope, items: unknown[], source: "api" | "import"): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  const ids: string[] = [];
  for (const [index, raw] of items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const number = str(it.asset);
    const fail = (code: string, message: string) => results.push({ index, asset: number || null, status: "error", code, message });
    const start = date(it.period_start);
    const end = date(it.period_end);
    if (!number) { fail("invalid", "“asset” is required."); continue; }
    if (!start || !end) { fail("invalid", "“period_start” and “period_end” must be ISO 8601 date-times."); continue; }
    if (end <= start) { fail("invalid", "“period_end” must be after “period_start”."); continue; }
    if (end.getTime() - start.getTime() > 92 * 86_400_000) { fail("invalid", "A period can be at most 92 days."); continue; }
    if (end > new Date(Date.now() + 86_400_000)) { fail("invalid", "The period can't end in the future."); continue; }
    if (typeof it.parts !== "number" || !Number.isInteger(it.parts) || it.parts < 0) { fail("invalid", "“parts” must be a non-negative whole number."); continue; }
    const a = await findAsset(who, scope, number);
    if (!a) { fail("not_found", "Asset not found (or outside this key's sites)."); continue; }
    const partNumber = str(it.part_number).toUpperCase();
    const key = { assetId_periodStart_periodEnd_partNumber: { assetId: a.id, periodStart: start, periodEnd: end, partNumber } };
    const existing = await db.productionReport.findUnique({ where: key });
    const r = await db.productionReport.upsert({
      where: key,
      create: { orgId: who.orgId, assetId: a.id, periodStart: start, periodEnd: end, partNumber, parts: it.parts, source, reference: str(it.reference).slice(0, 200) },
      // A corrected quantity is checked again from scratch.
      update: { parts: it.parts, reference: str(it.reference).slice(0, 200), status: "pending", expectedShots: null, recordedShots: null, checkedAt: null },
    });
    if (existing && existing.parts !== it.parts) await db.reconciliationException.deleteMany({ where: { reportId: r.id, status: "open" } });
    ids.push(r.id);
    results.push({ index, asset: a.number, status: existing ? "duplicate" : "created", report_id: r.id });
  }
  if (ids.length) {
    await reconcileReports(who.orgId, { reportIds: ids });
    const after = await db.productionReport.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, expectedShots: true, recordedShots: true } });
    for (const res of results) {
      const r = after.find((x) => x.id === res.report_id);
      if (r) Object.assign(res, { reconciliation: r.status, expected_shots: r.expectedShots, recorded_shots: r.recordedShots });
    }
    await audit({ orgId: who.orgId, userId: who.userId }, { action: "production_reported", entityType: "reconciliation", entityId: who.orgId, entityLabel: `${ids.length} production report(s)`, after: { count: ids.length, source }, reason: who.label });
  }
  return results;
}
