/** Lifecycle planning (spec §4.7): life forecast, budget rules, capacity. Pure functions, unit-tested. */

const DAY = 86_400_000;
const MONTH_DAYS = 30.4375;

// ─── Life forecast ──────────────────────────────────────────────────────────

/** Shots per month from readings in the trailing window (plus the last reading before it as the baseline). */
export function shotsPerMonth(readings: { readAt: Date; lifetime: number }[], now: Date, windowDays = 90): number | null {
  const sorted = [...readings].sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  const start = now.getTime() - windowDays * DAY;
  const inWindow = sorted.filter((r) => r.readAt.getTime() >= start && r.readAt <= now);
  const before = sorted.filter((r) => r.readAt.getTime() < start).pop();
  const pts = before ? [before, ...inWindow] : inWindow;
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const days = (last.readAt.getTime() - first.readAt.getTime()) / DAY;
  if (days < 7) return null;
  return Math.max(0, ((last.lifetime - first.lifetime) / days) * MONTH_DAYS);
}

export type LifeInput = {
  lifetime: number;
  rate: number | null;
  shotsBetweenRefurbs: number | null;
  lastRefurbShots: number | null;
  refurbsAllowed: number | null;
  refurbsDone: number;
  endOfLifeShots: number | null;
  warrantyShots: number | null;
};

export type LifeForecast = {
  /** Upcoming refurbishments (shot count and forecast date), within the allowed number and before end of life. */
  refurbs: { shots: number; date: Date | null }[];
  eol: { shots: number; date: Date | null; pct: number } | null;
  warranty: { shots: number; date: Date | null } | null;
};

/** Date the counter reaches `target` at `rate` shots/month; now if already past; null when the rate is unknown or zero. */
export function dateAtShots(target: number, lifetime: number, rate: number | null, now: Date): Date | null {
  if (lifetime >= target) return now;
  if (!rate || rate <= 0) return null;
  return new Date(now.getTime() + ((target - lifetime) / rate) * MONTH_DAYS * DAY);
}

export function lifeForecast(m: LifeInput, now: Date, horizonMonths = 120): LifeForecast {
  const refurbs: LifeForecast["refurbs"] = [];
  if (m.shotsBetweenRefurbs && m.shotsBetweenRefurbs > 0) {
    let next = (m.lastRefurbShots ?? 0) + m.shotsBetweenRefurbs;
    let remaining = m.refurbsAllowed == null ? 20 : Math.max(0, m.refurbsAllowed - m.refurbsDone);
    const horizon = m.rate ? m.lifetime + m.rate * horizonMonths : next;
    while (remaining > 0 && next <= horizon && (!m.endOfLifeShots || next < m.endOfLifeShots)) {
      refurbs.push({ shots: next, date: dateAtShots(next, m.lifetime, m.rate, now) });
      next += m.shotsBetweenRefurbs;
      remaining--;
    }
  }
  return {
    refurbs,
    eol: m.endOfLifeShots ? { shots: m.endOfLifeShots, date: dateAtShots(m.endOfLifeShots, m.lifetime, m.rate, now), pct: (m.lifetime / m.endOfLifeShots) * 100 } : null,
    warranty: m.warrantyShots ? { shots: m.warrantyShots, date: dateAtShots(m.warrantyShots, m.lifetime, m.rate, now) } : null,
  };
}

export function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** n month keys starting with the month of `from`. */
export function monthKeys(from: Date, n: number) {
  return Array.from({ length: n }, (_, i) => monthKey(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1))));
}

export function daysInMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ─── Budget ─────────────────────────────────────────────────────────────────

export const BUDGET_CATEGORIES = { pm: "Planned maintenance", parts: "Spare parts", refurbishment: "Refurbishment", replacement: "Replacement", other: "Other / corrective" } as const;
export type BudgetCategory = keyof typeof BUDGET_CATEGORIES;
export type BudgetRules = { pmCostPerService: number; partsPerCavity: number; refurbCost: number; replacementCost: number };

export function normalizeBudgetRules(raw: unknown): BudgetRules {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : 0);
  return { pmCostPerService: n("pmCostPerService"), partsPerCavity: n("partsPerCavity"), refurbCost: n("refurbCost"), replacementCost: n("replacementCost") };
}

/** Budget lines for one asset and year from its type's rules, plans and life forecast. */
export function budgetFromRules(
  rules: BudgetRules,
  a: { plans: { triggerType: string; interval: number }[]; shotsPerYear: number | null; cavities: number | null; refurbsInYear: number; eolInYear: boolean },
): Record<BudgetCategory, number> {
  const services = a.plans.reduce((s, p) => s + (p.interval <= 0 ? 0 : p.triggerType === "days" ? 365 / p.interval : a.shotsPerYear ? a.shotsPerYear / p.interval : 0), 0);
  const round = (v: number) => Math.round(v);
  return {
    pm: round(services * rules.pmCostPerService),
    parts: round((a.cavities ?? 0) * rules.partsPerCavity),
    refurbishment: round(a.refurbsInYear * rules.refurbCost),
    replacement: a.eolInYear ? round(rules.replacementCost) : 0,
    other: 0,
  };
}

/** Work-order spend by budget category, so budget and actual line up. */
export function actualByCategory(wos: { type: string; labor: number; parts: number; external: number }[]): Record<BudgetCategory, number> {
  const out: Record<BudgetCategory, number> = { pm: 0, parts: 0, refurbishment: 0, replacement: 0, other: 0 };
  for (const w of wos) {
    if (w.type === "refurbishment") out.refurbishment += w.labor + w.parts + w.external;
    else {
      out.parts += w.parts;
      if (w.type === "preventive" || w.type === "inspection") out.pm += w.labor + w.external;
      else out.other += w.labor + w.external;
    }
  }
  return out;
}

// ─── Capacity ───────────────────────────────────────────────────────────────

export type CapacityMold = {
  id: string;
  number: string;
  cycleS: number | null;
  activeCavities: number;
  /** Products made: cavities is set for family molds (cavities producing this part per shot). */
  products: { partNumber: string; cavities: number | null }[];
  refurbMonths: string[];
  /** First month the mold is past end of life (no capacity from then on). */
  eolMonth: string | null;
  /** First month with capacity (for a planned or what-if mold). */
  fromMonth?: string;
  hypothetical?: boolean;
};

export type CapacityCell = { demand: number; capacity: number; gap: number; utilisationPct: number | null; molds: { number: string; capacity: number }[] };

/** Parts per month a mold can make of one product. Products without a cavity count share the mold's time equally. */
export function moldCapacity(m: CapacityMold, partNumber: string, month: string, s: { hoursPerMonth: number; oeePct: number; refurbDowntimeDays: number }) {
  const prod = m.products.find((p) => p.partNumber === partNumber);
  if (!prod || !m.cycleS || m.cycleS <= 0) return 0;
  if (m.eolMonth && month >= m.eolMonth) return 0;
  if (m.fromMonth && month < m.fromMonth) return 0;
  const shared = m.products.filter((p) => p.cavities == null).length || 1;
  const cavities = prod.cavities != null ? Math.min(prod.cavities, m.activeCavities) : m.activeCavities / shared;
  const days = daysInMonth(month);
  const down = m.refurbMonths.includes(month) ? Math.min(days, s.refurbDowntimeDays) : 0;
  const hours = s.hoursPerMonth * ((days - down) / days);
  return Math.floor(cavities * (3600 / m.cycleS) * hours * (s.oeePct / 100));
}

export function capacityPlan(
  demand: { partNumber: string; month: string; quantity: number }[],
  molds: CapacityMold[],
  months: string[],
  s: { hoursPerMonth: number; oeePct: number; refurbDowntimeDays: number },
) {
  const parts = [...new Set([...demand.map((d) => d.partNumber), ...molds.flatMap((m) => m.products.map((p) => p.partNumber))])].sort();
  const rows = parts.map((partNumber) => {
    const makers = molds.filter((m) => m.products.some((p) => p.partNumber === partNumber));
    const cells: Record<string, CapacityCell> = {};
    for (const month of months) {
      const q = demand.filter((d) => d.partNumber === partNumber && d.month === month).reduce((t, d) => t + d.quantity, 0);
      const per = makers.map((m) => ({ number: m.number, capacity: moldCapacity(m, partNumber, month, s) }));
      const capacity = per.reduce((t, x) => t + x.capacity, 0);
      cells[month] = { demand: q, capacity, gap: capacity - q, utilisationPct: capacity > 0 ? (q / capacity) * 100 : q > 0 ? Infinity : null, molds: per };
    }
    return { partNumber, makers: makers.map((m) => m.number), cells, shortfallMonths: months.filter((mo) => cells[mo].gap < 0) };
  });
  return { rows, shortfalls: rows.reduce((t, r) => t + r.shortfallMonths.length, 0) };
}
