/**
 * Mold calculated fields, as defined in "Mold Calculated Fields" (tool lifecycle and capacity).
 * Every field returns either a value or the list of inputs it is missing, named as in that document,
 * so a passport can say exactly what to fill in. Pure functions, unit-tested.
 */

const DAY = 86_400_000;
/** Days per year used throughout the document's formulas. */
export const DAYS_PER_YEAR = 365.24;

/** Default cost per cavity by manufacturing process (from the document; currency as configured). */
export const DEFAULT_CAVITY_COSTS: Record<string, number | null> = {
  "Injection Blow": 15_000,
  "Injection Stretch Blow": 15_500,
  Injection: 16_000,
  "Precision Injection": 50_000,
  "Extrusion Blow": 7_500,
  "Stretch Blow": 12_000,
  Compression: 140,
  Thermoforming: null, // "TBD" in the document
  "Two Part Epoxy": 0,
};
export const PROCESSES = Object.keys(DEFAULT_CAVITY_COSTS);

/** Inputs, named after the document's fields. Null = not recorded. */
export type CalcInput = {
  cycleCount: number | null; // lifetime shots on the counter
  cycleCountDate: Date | null; // when the cycle count was last updated
  capitalizedDate: Date | null;
  refurbsAllowed: number | null;
  refurbsCompleted: number | null;
  shotsBetweenRefurb: number | null;
  shotsAtRefurbTotal: number | null; // cycle count at the last refurbishment
  annualVolume: number | null; // parts per year
  cavities: number | null; // # Cavities (design)
  activeCavities: number | null; // active cavities meter
  cycleTimeS: number | null;
  utilization: number | null; // 0–1
  process: string | null; // Department / manufacturing process
  costPerCavity: number | null; // for the process, from the organisation's table
  estimatedCostNewTool: number | null;
  // Location data (per site)
  hoursPerShift: number | null;
  shiftsPerDay: number | null;
  daysPerWeek: number | null;
  weeksPerYear: number | null;
  oee: number | null; // 0–1
};

export type Calc<T> = { value: T; missing?: never; note?: string } | { value: null; missing: string[]; note?: string };
const ok = <T>(value: T, note?: string): Calc<T> => ({ value, ...(note ? { note } : {}) });
const need = (missing: string[], note?: string): Calc<never> => ({ value: null, missing, ...(note ? { note } : {}) });

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
/** Names of inputs that are missing or not positive where a positive number is required. */
function missingOf(i: CalcInput, req: [keyof CalcInput, string][], positive: (keyof CalcInput)[] = []) {
  return req.filter(([k]) => {
    const v = i[k];
    if (v instanceof Date) return false;
    if (typeof v === "string") return !v;
    if (!has(v as number | null)) return true;
    return positive.includes(k) && (v as number) <= 0;
  }).map(([, label]) => label);
}
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

export type CalcResults = ReturnType<typeof calculate>;

/** All calculated fields for one mold. `now` decides the refurbishment priority. */
export function calculate(i: CalcInput, now = new Date()) {
  // ── Tool lifecycle
  const lifeShots = has(i.refurbsAllowed) && has(i.shotsBetweenRefurb) ? (i.refurbsAllowed + 1) * i.shotsBetweenRefurb : null;
  const annualShots = has(i.annualVolume) && has(i.cavities) && i.cavities > 0 ? i.annualVolume / i.cavities : null;
  const useCount = has(i.cycleCount) && !!i.cycleCountDate;

  const shotsUntilRefurb: Calc<number> = (() => {
    const m = missingOf(i, [["cycleCount", "Cycle Count"], ["refurbsCompleted", "Refurbs Completed"], ["shotsBetweenRefurb", "Shots Between Refurb"]]);
    if (m.length) return need(m);
    return ok((i.refurbsCompleted! + 1) * i.shotsBetweenRefurb! - i.cycleCount!);
  })();

  const shotsSinceLastRefurb: Calc<number> = (() => {
    if (!has(i.cycleCount)) return need(["Cycle Count"]);
    // Never refurbished: everything since new counts.
    return ok(i.cycleCount - (i.shotsAtRefurbTotal ?? 0), has(i.shotsAtRefurbTotal) ? undefined : "No refurbishment recorded, so this is the full cycle count.");
  })();

  const refurbsRemaining: Calc<number> = (() => {
    const m = missingOf(i, [["refurbsAllowed", "Refurbs Allowed"], ["refurbsCompleted", "Refurbs Completed"]]);
    return m.length ? need(m) : ok(Math.max(0, i.refurbsAllowed! - i.refurbsCompleted!));
  })();

  const expectedEndOfLife: Calc<Date> = (() => {
    const base: [keyof CalcInput, string][] = [["refurbsAllowed", "Refurbs Allowed"], ["shotsBetweenRefurb", "Shots Between Refurb"], ["annualVolume", "Annual Volume"], ["cavities", "# Cavities"]];
    const m = missingOf(i, base, ["annualVolume", "cavities"]);
    if (useCount) return m.length ? need(m) : ok(addDays(i.cycleCountDate!, ((lifeShots! - i.cycleCount!) / annualShots!) * DAYS_PER_YEAR));
    if (!i.capitalizedDate) return need(["Cycle Count (or Capitalized Date)", ...m]);
    return m.length ? need(m) : ok(addDays(i.capitalizedDate, (lifeShots! / annualShots!) * DAYS_PER_YEAR), "Estimated from the Capitalized Date: no cycle count recorded.");
  })();

  const nextRefurbishment: Calc<Date> = (() => {
    if (has(i.refurbsAllowed) && has(i.refurbsCompleted) && i.refurbsCompleted >= i.refurbsAllowed) return need([], "No refurbishments remaining: the next event is end of life.");
    if (useCount) {
      const m = missingOf(i, [["refurbsCompleted", "Refurbs Completed"], ["shotsBetweenRefurb", "Shots Between Refurb"], ["annualVolume", "Annual Volume"], ["cavities", "# Cavities"]], ["annualVolume", "cavities"]);
      return m.length ? need(m) : ok(addDays(i.cycleCountDate!, (shotsUntilRefurb.value! / annualShots!) * DAYS_PER_YEAR));
    }
    const m = missingOf(i, [["refurbsCompleted", "Refurbs Completed"], ["shotsBetweenRefurb", "Shots Between Refurb"], ["annualVolume", "Annual Volume"], ["cavities", "# Cavities"]], ["annualVolume", "cavities"]);
    if (!i.capitalizedDate) return need(["Cycle Count (or Capitalized Date)", ...m]);
    return m.length ? need(m) : ok(addDays(i.capitalizedDate, (((i.refurbsCompleted! + 1) * i.shotsBetweenRefurb!) / annualShots!) * DAYS_PER_YEAR), "Estimated from the Capitalized Date: no cycle count recorded.");
  })();

  const refurbishmentPriority: Calc<"Critical" | "Consider" | "Not necessary"> = (() => {
    if (nextRefurbishment.value == null) return need(nextRefurbishment.missing.length ? ["Next Refurbishment", ...nextRefurbishment.missing] : [], nextRefurbishment.note);
    const d = nextRefurbishment.value.getTime() - now.getTime();
    return ok(d < 0 ? "Critical" : d < DAYS_PER_YEAR * DAY ? "Consider" : "Not necessary");
  })();

  const remainingLifePct: Calc<number> = (() => {
    const m = missingOf(i, [["cycleCount", "Cycle Count"], ["refurbsAllowed", "Refurbs Allowed"], ["shotsBetweenRefurb", "Shots Between Refurb"]], ["shotsBetweenRefurb"]);
    return m.length ? need(m) : ok((1 - i.cycleCount! / lifeShots!) * 100);
  })();

  const calculatedReplacementCost: Calc<number> = (() => {
    const m = missingOf(i, [["cavities", "# Cavities"], ["process", "Department"]]);
    if (m.length) return need(m);
    if (!has(i.costPerCavity)) return need([`Cost per cavity for “${i.process}”`]);
    return ok(i.costPerCavity * i.cavities!);
  })();

  const costAverageRefurb: Calc<number> = (() => {
    if (i.process === "Two Part Epoxy") return ok(0, "Two Part Epoxy: no refurbishment cost is calculated.");
    const newTool = has(i.estimatedCostNewTool) ? i.estimatedCostNewTool : calculatedReplacementCost.value;
    if (!has(newTool)) return need(["Estimated Cost New Tool"]);
    return ok(newTool / 3, has(i.estimatedCostNewTool) ? undefined : "Using the Calculated Replacement Cost as the estimated cost of a new tool.");
  })();

  // ── Capacity
  const asset: [keyof CalcInput, string][] = [["cycleTimeS", "Cycle Time"], ["cavities", "# Cavities"]];
  const loc: [keyof CalcInput, string][] = [["hoursPerShift", "Hours per Shift"], ["shiftsPerDay", "Shifts per Day"], ["oee", "OEE"]];
  const dailyOutputCapacity: Calc<number> = (() => {
    const m = missingOf(i, [...asset, ...loc], ["cycleTimeS"]);
    return m.length ? need(m) : ok((3600 / i.cycleTimeS!) * i.hoursPerShift! * i.shiftsPerDay! * i.cavities! * i.oee!);
  })();
  const weeklyOutputCapacity: Calc<number> = (() => {
    const m = [...(dailyOutputCapacity.missing ?? []), ...missingOf(i, [["daysPerWeek", "Days per Week"]])];
    return m.length ? need(m) : ok(dailyOutputCapacity.value! * i.daysPerWeek!);
  })();
  const annualOutputCapacity: Calc<number> = (() => {
    const m = [...(weeklyOutputCapacity.missing ?? []), ...missingOf(i, [["weeksPerYear", "Weeks per Year"]])];
    return m.length ? need(m) : ok(weeklyOutputCapacity.value! * i.weeksPerYear!);
  })();
  const freeAnnualCapacityPcs: Calc<number> = (() => {
    const m = [...(annualOutputCapacity.missing ?? []), ...missingOf(i, [["annualVolume", "Annual Volume"]])];
    return m.length ? need(m) : ok(annualOutputCapacity.value! - i.annualVolume!);
  })();
  const freeAnnualCapacityPct: Calc<number> = (() => {
    if (freeAnnualCapacityPcs.value == null) return need(freeAnnualCapacityPcs.missing);
    return annualOutputCapacity.value! > 0 ? ok((freeAnnualCapacityPcs.value / annualOutputCapacity.value!) * 100) : need(["Annual Output Capacity above zero"]);
  })();
  const calculatedAnnualVolume: Calc<number> = (() => {
    const m = missingOf(i, [...asset, ["utilization", "Utilization"]], ["cycleTimeS"]);
    return m.length ? need(m) : ok((0.85 * (DAYS_PER_YEAR * 24 * 60 * 60) * i.utilization! * i.cavities!) / i.cycleTimeS!);
  })();
  const calculatedUtilizationPct: Calc<number> = (() => {
    const m = [...(annualOutputCapacity.missing ?? []), ...missingOf(i, [["annualVolume", "Annual Volume"]])];
    if (m.length) return need(m);
    return annualOutputCapacity.value! > 0 ? ok((i.annualVolume! / annualOutputCapacity.value!) * 100) : need(["Annual Output Capacity above zero"]);
  })();
  const productionDaysRequired: Calc<number> = (() => {
    const m = [...(dailyOutputCapacity.missing ?? []), ...missingOf(i, [["annualVolume", "Annual Volume"]])];
    if (m.length) return need(m);
    return dailyOutputCapacity.value! > 0 ? ok(i.annualVolume! / dailyOutputCapacity.value!) : need(["Daily Output Capacity above zero"]);
  })();
  const actualCavitationPct: Calc<number> = (() => {
    const m = missingOf(i, [["cavities", "# Cavities"], ["activeCavities", "Active Cavities"]], ["cavities"]);
    return m.length ? need(m) : ok((i.activeCavities! / i.cavities!) * 100);
  })();

  return {
    lifecycle: { expectedEndOfLife, nextRefurbishment, shotsSinceLastRefurb, shotsUntilRefurb, refurbsRemaining, calculatedReplacementCost, costAverageRefurb, refurbishmentPriority, remainingLifePct },
    capacity: { dailyOutputCapacity, weeklyOutputCapacity, annualOutputCapacity, freeAnnualCapacityPcs, freeAnnualCapacityPct, calculatedAnnualVolume, calculatedUtilizationPct, productionDaysRequired, actualCavitationPct },
  };
}

/** Display names, units and descriptions (from the document). */
export const CALC_FIELDS = {
  expectedEndOfLife: { label: "Expected End of Life", kind: "date", help: "Estimated retirement date from the cycle count, shots between refurbishments and annual volume." },
  nextRefurbishment: { label: "Next Refurbishment", kind: "date", help: "Estimated date the tool needs refurbishing." },
  shotsSinceLastRefurb: { label: "Shots Since Last Refurb", kind: "shots", help: "Cycle count minus the count at the last refurbishment." },
  shotsUntilRefurb: { label: "Shots Until Refurb", kind: "shots", help: "Cycles before the next expected refurbishment." },
  refurbsRemaining: { label: "Refurbs Remaining", kind: "int", help: "Refurbishments still allowed before retirement." },
  calculatedReplacementCost: { label: "Calculated Replacement Cost", kind: "money", help: "Cost per cavity for the manufacturing process × # cavities." },
  costAverageRefurb: { label: "Cost Average Refurb", kind: "money", help: "Estimated cost of a new tool ÷ 3." },
  refurbishmentPriority: { label: "Refurbishment Priority", kind: "text", help: "Critical if the next refurbishment is past, Consider if within a year, else Not necessary." },
  remainingLifePct: { label: "Remaining Life", kind: "pct", help: "1 − cycle count ÷ ((refurbs allowed + 1) × shots between refurb)." },
  dailyOutputCapacity: { label: "Daily Output Capacity", kind: "parts", help: "3600 ÷ cycle time × hours per shift × shifts per day × # cavities × OEE." },
  weeklyOutputCapacity: { label: "Weekly Output Capacity", kind: "parts", help: "Daily output capacity × days per week." },
  annualOutputCapacity: { label: "Annual Output Capacity", kind: "parts", help: "Weekly output capacity × weeks per year." },
  freeAnnualCapacityPcs: { label: "Free Annual Capacity (pcs)", kind: "parts", help: "Annual output capacity − annual volume." },
  freeAnnualCapacityPct: { label: "Free Annual Capacity (%)", kind: "pct", help: "Free annual capacity ÷ annual output capacity." },
  calculatedAnnualVolume: { label: "Calculated Annual Volume", kind: "parts", help: "0.85 × seconds per year × utilization × # cavities ÷ cycle time." },
  calculatedUtilizationPct: { label: "Calculated % Utilization", kind: "pct", help: "Annual volume ÷ annual output capacity." },
  productionDaysRequired: { label: "Production Days Required", kind: "days", help: "Annual volume ÷ daily output capacity." },
  actualCavitationPct: { label: "Actual Cavitation %", kind: "pct", help: "Active cavities ÷ # cavities." },
} as const;
export type CalcKey = keyof typeof CALC_FIELDS;

/** Flatten results to numbers for custom formula fields (dates as days from now). */
export function calcVars(r: CalcResults, now = new Date()): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const group of [r.lifecycle, r.capacity] as Record<string, Calc<unknown>>[]) {
    for (const [k, c] of Object.entries(group)) {
      const name = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      const v = c.value;
      out[name] = v instanceof Date ? Math.round((v.getTime() - now.getTime()) / DAY) : typeof v === "number" ? v : null;
    }
  }
  return out;
}

type Num = number | { toNumber(): number } | null | undefined;
const n = (v: Num) => (v == null ? null : typeof v === "number" ? v : v.toNumber());

/** Cost per cavity for a process: the organisation's own figure, else the document's default. */
export function costPerCavity(process: string, orgCosts: unknown): number | null {
  if (!process) return null;
  const own = (orgCosts ?? {}) as Record<string, unknown>;
  if (typeof own[process] === "number") return own[process] as number;
  return DEFAULT_CAVITY_COSTS[process] ?? null;
}

/** Build calculation inputs from a stored asset, its counter, cavities and site. */
export function inputFromAsset(
  a: {
    designCavities: number | null; designCycleTimeS: number | null; refurbsAllowed: number | null; refurbsDone: number; shotsBetweenRefurbs: number | null;
    lastRefurbShots: number | null; capitalisationDate: Date | null; annualVolume: number | null; utilizationPct: number | null; process: string; estimatedNewToolCost: Num;
    meters: { kind: string; lifetimeTotal: number; lastReadingAt: Date | null }[]; cavities: { status: string }[];
    site: { hoursPerShift: number | null; shiftsPerDay: number | null; daysPerWeek: number | null; weeksPerYear: number | null; oeePct: number | null };
  },
  org: { cavityCosts: unknown },
): CalcInput {
  const meter = a.meters.find((m) => m.kind === "shots");
  const counted = meter?.lastReadingAt ? meter : null;
  return {
    cycleCount: counted ? counted.lifetimeTotal : null,
    cycleCountDate: counted?.lastReadingAt ?? null,
    capitalizedDate: a.capitalisationDate,
    refurbsAllowed: a.refurbsAllowed,
    refurbsCompleted: a.refurbsDone,
    shotsBetweenRefurb: a.shotsBetweenRefurbs,
    shotsAtRefurbTotal: a.lastRefurbShots,
    annualVolume: a.annualVolume,
    cavities: a.designCavities,
    activeCavities: a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : null,
    cycleTimeS: a.designCycleTimeS,
    utilization: a.utilizationPct == null ? null : a.utilizationPct / 100,
    process: a.process || null,
    costPerCavity: costPerCavity(a.process, org.cavityCosts),
    estimatedCostNewTool: n(a.estimatedNewToolCost),
    hoursPerShift: a.site.hoursPerShift,
    shiftsPerDay: a.site.shiftsPerDay,
    daysPerWeek: a.site.daysPerWeek,
    weeksPerYear: a.site.weeksPerYear,
    oee: a.site.oeePct == null ? null : a.site.oeePct / 100,
  };
}

/** Variable names of the calculated fields in custom formulas (e.g. remaining_life_pct). */
export const CALC_VARS = Object.keys(CALC_FIELDS).map((k) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`));
