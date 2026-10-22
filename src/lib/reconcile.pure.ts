/** Shot reconciliation (spec §4.3): counter shots vs production-reported parts ÷ cavities. Pure, unit-tested. */

const DAY = 86_400_000;

export type ReconOptions = { tolerancePct: number; minShots: number; windowDays: number; giveUpDays?: number };
export type Reading = { readAt: Date; lifetime: number };

export type ReconResult =
  | { status: "pending" | "unverifiable"; reason: string; expectedShots: number | null }
  | { status: "matched" | "exception"; expectedShots: number; recordedShots: number; gap: number; gapPct: number; tolerance: number; from: Reading; to: Reading };

/** The reading closest to `t` within the window, or null. */
export function nearestReading(readings: Reading[], t: Date, windowDays: number) {
  let best: Reading | null = null;
  for (const r of readings) {
    const d = Math.abs(r.readAt.getTime() - t.getTime());
    if (d <= windowDays * DAY && (!best || d < Math.abs(best.readAt.getTime() - t.getTime()))) best = r;
  }
  return best;
}

/**
 * A production report is checked once there are counter readings (manual, handover, import or API) within
 * `windowDays` of both its start and end. Until then it waits; after `giveUpDays` it is marked unverifiable.
 */
export function reconcile(report: { periodStart: Date; periodEnd: Date; parts: number }, readings: Reading[], cavities: number | null, o: ReconOptions, now = new Date()): ReconResult {
  if (!cavities || cavities <= 0) return { status: "unverifiable", reason: "No active cavities recorded for this mold or part.", expectedShots: null };
  const expectedShots = Math.round(report.parts / cavities);
  const from = nearestReading(readings, report.periodStart, o.windowDays);
  const to = nearestReading(readings, report.periodEnd, o.windowDays);
  if (!from || !to || to.readAt <= from.readAt) {
    const late = now.getTime() > report.periodEnd.getTime() + (o.giveUpDays ?? 30) * DAY;
    return { status: late ? "unverifiable" : "pending", reason: `Needs counter readings within ${o.windowDays} day(s) of the period start and end.`, expectedShots };
  }
  const recordedShots = to.lifetime - from.lifetime;
  const gap = recordedShots - expectedShots;
  const tolerance = Math.max(o.minShots, Math.round((expectedShots * o.tolerancePct) / 100));
  const gapPct = expectedShots ? Math.round((gap / expectedShots) * 1000) / 10 : 0;
  return { status: Math.abs(gap) > tolerance ? "exception" : "matched", expectedShots, recordedShots, gap, gapPct, tolerance, from, to };
}
