/** Downtime rules (spec §4.9): validation, MTBF, MTTR and availability. Pure functions, unit-tested. */

export const DOWNTIME_CATEGORIES = {
  failure: "Failure",
  planned: "Planned",
  external: "External",
} as const;
export type DowntimeCategory = keyof typeof DOWNTIME_CATEGORIES;

export const CATEGORY_HELP: Record<DowntimeCategory, string> = {
  failure: "The mold broke down. Counts as a failure for MTBF and MTTR, and against availability.",
  planned: "Planned stops on the mold, such as maintenance, refurbishment or a mold change. Counts against availability, not as a failure.",
  external: "Stops that are not the mold's fault, such as a press breakdown, no material or no orders. Recorded, but excluded from the mold's availability.",
};

export const CATEGORY_COLOR = { failure: "red", planned: "blue", external: "gray" } as const;

/** Standard codes each organisation starts with; they can be renamed, added to or switched off. */
export const DEFAULT_CODES: { code: string; name: string; category: DowntimeCategory }[] = [
  { code: "MECH", name: "Mechanical damage (core, cavity, slide, lifter)", category: "failure" },
  { code: "HR", name: "Hot runner fault (heater, thermocouple, nozzle)", category: "failure" },
  { code: "COOL", name: "Water leak or cooling problem", category: "failure" },
  { code: "EJECT", name: "Ejection problem", category: "failure" },
  { code: "QUAL", name: "Parts out of specification (flash, short shots)", category: "failure" },
  { code: "PM", name: "Preventive maintenance", category: "planned" },
  { code: "REFURB", name: "Refurbishment", category: "planned" },
  { code: "CHANGE", name: "Mold change and setup", category: "planned" },
  { code: "TRIAL", name: "Trial or qualification", category: "planned" },
  { code: "PRESS", name: "Press breakdown", category: "external" },
  { code: "MATL", name: "No material", category: "external" },
  { code: "ORDERS", name: "No production orders", category: "external" },
  { code: "UTIL", name: "Power or utilities", category: "external" },
];

const H = 3_600_000;
/** Clock drift allowed when someone records "now" from a phone. */
const FUTURE_SLACK_MS = 5 * 60_000;

export type Interval = { startedAt: Date; endedAt: Date | null };

/** Why an event can't be saved, or null. `others` are the asset's other events. */
export function validateDowntime(e: Interval, others: (Interval & { number: string })[], now = new Date()): string | null {
  if (Number.isNaN(e.startedAt.getTime())) return "Enter when the downtime started.";
  if (e.endedAt && Number.isNaN(e.endedAt.getTime())) return "The end time is not a valid date.";
  if (e.startedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) return "Downtime can't start in the future.";
  if (e.endedAt && e.endedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) return "Downtime can't end in the future. Leave the end blank while the mold is still down.";
  if (e.endedAt && e.endedAt <= e.startedAt) return "The end must be after the start.";
  const end = e.endedAt?.getTime() ?? Infinity;
  const clash = others.find((o) => o.startedAt.getTime() < end && (o.endedAt?.getTime() ?? Infinity) > e.startedAt.getTime());
  if (clash) return clash.endedAt ? `This overlaps ${clash.number}, which already covers part of that time.` : `${clash.number} is still open for this mold. End it first.`;
  return null;
}

/** Total hours covered by the intervals inside [from, to], counting overlaps once. */
export function coveredHours(intervals: Interval[], from: Date, to: Date, now = new Date()): number {
  const lo = from.getTime();
  const hi = Math.min(to.getTime(), now.getTime());
  const clipped = intervals
    .map((i) => [Math.max(lo, i.startedAt.getTime()), Math.min(hi, i.endedAt?.getTime() ?? now.getTime())] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of clipped) {
    if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total / H;
}

export type DtEvent = Interval & { assetId: string; category: string; codeId: string };
export type DtAsset = { id: string; trackedFrom: Date };

export type DtStats = {
  /** Calendar hours each asset was tracked in the period, summed */
  periodHours: number;
  failureHours: number;
  plannedHours: number;
  externalHours: number;
  /** Failure and planned time together (overlaps counted once): what availability is reduced by */
  moldDownHours: number;
  /** Failure events starting in the period */
  failures: number;
  /** Failure events that started in the period and have ended (MTTR is their average length) */
  repairs: number;
  repairHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availabilityPct: number | null;
  openNow: number;
};

function empty(): DtStats {
  return { periodHours: 0, failureHours: 0, plannedHours: 0, externalHours: 0, moldDownHours: 0, failures: 0, repairs: 0, repairHours: 0, mttrHours: null, mtbfHours: null, availabilityPct: null, openNow: 0 };
}

function finish(s: DtStats): DtStats {
  const up = Math.max(0, s.periodHours - s.moldDownHours);
  return {
    ...s,
    mttrHours: s.repairs ? s.repairHours / s.repairs : null,
    mtbfHours: s.failures ? up / s.failures : null,
    availabilityPct: s.periodHours > 0 ? (up / s.periodHours) * 100 : null,
  };
}

/** Pool several assets' figures (fleet, site or asset type): sums the hours and counts, then recomputes the ratios. */
export function combineStats(list: DtStats[]): DtStats {
  const t = empty();
  for (const s of list) for (const k of ["periodHours", "failureHours", "plannedHours", "externalHours", "moldDownHours", "failures", "repairs", "repairHours", "openNow"] as const) t[k] += s[k];
  return finish(t);
}

/**
 * MTBF, MTTR and availability for each asset and for the fleet, over [start, end].
 * - Period time is calendar time from the period start, or from when the asset was first tracked if that is later
 *   (its passport's creation, or its earliest recorded downtime when history was imported).
 * - Availability = (period time − failure and planned downtime) ÷ period time. External downtime is excluded.
 * - MTBF = (period time − failure and planned downtime) ÷ failures starting in the period.
 * - MTTR = average length of failure events that started in the period and have ended.
 */
export function downtimeMetrics(assets: DtAsset[], events: DtEvent[], start: Date, end: Date, now = new Date()) {
  const per = new Map<string, DtStats>();
  const until = new Date(Math.min(end.getTime(), now.getTime()));
  const byAsset = new Map<string, DtEvent[]>();
  for (const e of events) (byAsset.get(e.assetId) ?? byAsset.set(e.assetId, []).get(e.assetId)!).push(e);

  for (const a of assets) {
    const from = new Date(Math.max(start.getTime(), a.trackedFrom.getTime()));
    const evs = byAsset.get(a.id) ?? [];
    const s = empty();
    s.periodHours = Math.max(0, (until.getTime() - from.getTime()) / H);
    const of = (c: string) => evs.filter((e) => e.category === c);
    s.failureHours = coveredHours(of("failure"), from, until, now);
    s.plannedHours = coveredHours(of("planned"), from, until, now);
    s.externalHours = coveredHours(of("external"), from, until, now);
    s.moldDownHours = coveredHours([...of("failure"), ...of("planned")], from, until, now);
    const started = of("failure").filter((e) => e.startedAt >= from && e.startedAt <= until);
    s.failures = started.length;
    const ended = started.filter((e) => e.endedAt && e.endedAt <= now);
    s.repairs = ended.length;
    s.repairHours = ended.reduce((t, e) => t + (e.endedAt!.getTime() - e.startedAt.getTime()) / H, 0);
    s.openNow = evs.filter((e) => !e.endedAt).length;
    per.set(a.id, finish(s));
  }
  const total = combineStats([...per.values()]);

  // Hours and stops by code, for a Pareto of reasons.
  const codes = new Map<string, { codeId: string; hours: number; count: number }>();
  const tracked = new Set(assets.map((a) => a.id));
  for (const e of events) {
    if (!tracked.has(e.assetId)) continue;
    const hours = coveredHours([e], start, until, now);
    const overlaps = e.startedAt <= until && (e.endedAt ?? now) >= start;
    if (!overlaps) continue;
    const c = codes.get(e.codeId) ?? { codeId: e.codeId, hours: 0, count: 0 };
    c.hours += hours;
    c.count++;
    codes.set(e.codeId, c);
  }
  return { total, perAsset: per, byCode: [...codes.values()].sort((a, b) => b.hours - a.hours) };
}

/** "45 min", "3 h 20 min", "2 d 4 h". */
export function fmtDuration(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  const mins = Math.round(hours * 60);
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(mins / 1440);
  const h = Math.round((mins % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function durationHours(e: Interval, now = new Date()) {
  return ((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / H;
}
