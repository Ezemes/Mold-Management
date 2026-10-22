import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { notify, recipientsFor } from "./notify";
import { emitEvent } from "./webhooks";
import { reconcile } from "./reconcile.pure";

export * from "./reconcile.pure";

const DAY = 86_400_000;

/** Cavities producing `partNumber` per shot: a family mold's per-part count, else the active cavities. */
export function cavitiesFor(a: { designCavities: number | null; cavities: { status: string }[]; products: { partNumber: string; cavitiesUsed: number | null }[] }, partNumber: string) {
  const active = a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : (a.designCavities ?? 0);
  const prod = partNumber ? a.products.find((p) => p.partNumber.toLowerCase() === partNumber.toLowerCase()) : undefined;
  return prod?.cavitiesUsed != null ? Math.min(prod.cavitiesUsed, active) : active;
}

/**
 * Check pending production reports (all of an org's, or those for some assets/reports). Raises a
 * reconciliation exception, an alert and a webhook for each gap beyond tolerance. Safe to run repeatedly.
 */
export async function reconcileReports(orgId: string, f: { assetIds?: string[]; reportIds?: string[] } = {}, now = new Date()) {
  const org = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
  const where: Prisma.ProductionReportWhereInput = { orgId, status: "pending", ...(f.assetIds ? { assetId: { in: f.assetIds } } : {}), ...(f.reportIds ? { id: { in: f.reportIds } } : {}) };
  const reports = await db.productionReport.findMany({ where, include: { asset: { include: { meters: true, cavities: { select: { status: true } }, products: true } } }, take: 5000 });
  const opts = { tolerancePct: org.reconTolerancePct, minShots: org.reconMinShots, windowDays: org.reconWindowDays };
  const out = { checked: reports.length, matched: 0, exceptions: 0, pending: 0, unverifiable: 0 };
  for (const r of reports) {
    const meter = r.asset.meters.find((m) => m.kind === "shots");
    const readings = meter
      ? await db.meterReading.findMany({
          where: { meterId: meter.id, readAt: { gte: new Date(r.periodStart.getTime() - opts.windowDays * DAY), lte: new Date(r.periodEnd.getTime() + opts.windowDays * DAY) } },
          select: { readAt: true, lifetime: true },
        })
      : [];
    const res = reconcile(r, readings, cavitiesFor(r.asset, r.partNumber), opts, now);
    out[res.status === "exception" ? "exceptions" : res.status]++;
    if (res.status === "pending") continue;
    const recorded = "recordedShots" in res ? res.recordedShots : null;
    await db.productionReport.update({ where: { id: r.id }, data: { status: res.status, expectedShots: res.expectedShots, recordedShots: recorded, checkedAt: now } });
    if (res.status !== "exception") continue;
    const ex = await db.reconciliationException.upsert({
      where: { reportId: r.id },
      create: { orgId, assetId: r.assetId, reportId: r.id, expectedShots: res.expectedShots, recordedShots: res.recordedShots, gap: res.gap, gapPct: res.gapPct },
      update: { expectedShots: res.expectedShots, recordedShots: res.recordedShots, gap: res.gap, gapPct: res.gapPct },
    });
    const period = `${r.periodStart.toISOString().slice(0, 10)} – ${r.periodEnd.toISOString().slice(0, 10)}`;
    const body = `Counter ${res.recordedShots.toLocaleString("en-IN")} shots vs ${res.expectedShots.toLocaleString("en-IN")} from ${r.parts.toLocaleString("en-IN")} parts (${res.gap > 0 ? "+" : ""}${res.gap.toLocaleString("en-IN")}, ${res.gapPct}%) for ${period}.`;
    const users = await recipientsFor(orgId, "readings", "edit", { siteId: r.asset.siteId, partnerIds: [r.asset.custodianPartnerId] });
    await notify(orgId, users, { kind: "reconciliation_exception", title: `Shot count gap on ${r.asset.number}`, body, link: `/reconciliation?view=open`, dedupeKey: `recon:${r.id}` });
    await emitEvent(orgId, "reconciliation.exception", { exception_id: ex.id, asset: r.asset.number, period_start: r.periodStart.toISOString(), period_end: r.periodEnd.toISOString(), part_number: r.partNumber || null, parts: r.parts, expected_shots: res.expectedShots, recorded_shots: res.recordedShots, gap: res.gap, gap_pct: res.gapPct }, { dedupeKey: `recon:${r.id}` });
  }
  return out;
}
