/** Mold–press compatibility (spec §4.2). Pure functions, unit-tested. */

export const RULES = {
  tonnage: "Clamp tonnage",
  tie_bar: "Fits between tie bars",
  platen: "Fits on the platens",
  mold_height: "Mold height window",
  opening: "Opening stroke",
  shot_size: "Shot size",
  locating_ring: "Locating ring",
  nozzle: "Nozzle radius",
  hot_runner: "Hot-runner zones",
  weight: "Mold weight",
} as const;
export type RuleKey = keyof typeof RULES;

export type CompatRules = {
  enabled: Record<RuleKey, boolean>;
  /** Press tonnage must exceed the mold's requirement by this margin. */
  tonnageMarginPct: number;
  /** Shot weight as % of the press's shot capacity must fall in this window. */
  shotMinPct: number;
  shotMaxPct: number;
  /** Allowed difference between locating-ring diameters. */
  ringTolMm: number;
};

export const DEFAULT_RULES: CompatRules = {
  enabled: Object.fromEntries(Object.keys(RULES).map((k) => [k, true])) as Record<RuleKey, boolean>,
  tonnageMarginPct: 0,
  shotMinPct: 20,
  shotMaxPct: 80,
  ringTolMm: 0.5,
};

const num = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : d);

export function normalizeRules(raw: unknown): CompatRules {
  const r = (raw ?? {}) as Partial<CompatRules> & { enabled?: Partial<Record<RuleKey, unknown>> };
  const enabled = { ...DEFAULT_RULES.enabled };
  for (const k of Object.keys(RULES) as RuleKey[]) if (r.enabled && typeof r.enabled[k] === "boolean") enabled[k] = r.enabled[k] as boolean;
  const shotMinPct = num(r.shotMinPct, DEFAULT_RULES.shotMinPct, 0, 100);
  return {
    enabled,
    tonnageMarginPct: num(r.tonnageMarginPct, DEFAULT_RULES.tonnageMarginPct, 0, 100),
    shotMinPct,
    shotMaxPct: Math.max(shotMinPct, num(r.shotMaxPct, DEFAULT_RULES.shotMaxPct, 0, 100)),
    ringTolMm: num(r.ringTolMm, DEFAULT_RULES.ringTolMm, 0, 50),
  };
}

type N = number | null | undefined;
export type MoldSpec = { clampTonnageT: N; widthMm: N; heightMm: N; stackHeightMm: N; openingStrokeMm: N; shotWeightG: N; locatingRingMm: N; sprueRadiusMm: N; hotRunnerZones: N; weightKg: N };
export type PressSpec = { clampTonnageT: N; tieBarHMm: N; tieBarVMm: N; platenWMm: N; platenHMm: N; minMoldHeightMm: N; maxMoldHeightMm: N; maxOpeningMm: N; shotCapacityG: N; locatingRingMm: N; nozzleRadiusMm: N; hotRunnerZones: N; maxMoldWeightKg: N };

export type Check = { rule: RuleKey; label: string; result: "pass" | "fail" | "unknown"; detail: string };
export type Verdict = { compatible: boolean; checks: Check[]; failures: Check[]; unknowns: Check[] };

const has = (v: N): v is number => typeof v === "number" && Number.isFinite(v);
const f = (v: number, digits = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: digits });

/** Run every enabled rule. Missing data never fails a rule; it is reported as "not checked". */
export function checkCompat(m: MoldSpec, p: PressSpec, rules: CompatRules = DEFAULT_RULES): Verdict {
  const checks: Check[] = [];
  const add = (rule: RuleKey, result: Check["result"], detail: string) => checks.push({ rule, label: RULES[rule], result, detail });
  const missing = (rule: RuleKey, what: string) => add(rule, "unknown", `Not checked: ${what} not recorded`);
  const on = rules.enabled;

  if (on.tonnage) {
    if (!has(m.clampTonnageT) || !has(p.clampTonnageT)) missing("tonnage", !has(m.clampTonnageT) ? "mold tonnage" : "press tonnage");
    else {
      const need = m.clampTonnageT * (1 + rules.tonnageMarginPct / 100);
      add("tonnage", p.clampTonnageT >= need ? "pass" : "fail", `Needs ${f(need)} t${rules.tonnageMarginPct ? ` (${f(m.clampTonnageT)} t + ${rules.tonnageMarginPct}%)` : ""}, press has ${f(p.clampTonnageT)} t`);
    }
  }
  if (on.tie_bar) {
    if (!has(m.widthMm) || !has(m.heightMm) || !has(p.tieBarHMm)) missing("tie_bar", !has(p.tieBarHMm) ? "tie-bar spacing" : "mold width/height");
    else {
      const narrow = Math.min(m.widthMm, m.heightMm);
      add("tie_bar", narrow <= p.tieBarHMm ? "pass" : "fail", `Mold ${f(m.widthMm)} × ${f(m.heightMm)} mm; narrowest side ${f(narrow)} mm vs ${f(p.tieBarHMm)} mm between tie bars`);
    }
  }
  if (on.platen) {
    if (!has(m.widthMm) || !has(m.heightMm) || !has(p.platenWMm) || !has(p.platenHMm)) missing("platen", !has(p.platenWMm) || !has(p.platenHMm) ? "platen size" : "mold width/height");
    else {
      const fits = (m.widthMm <= p.platenWMm && m.heightMm <= p.platenHMm) || (m.heightMm <= p.platenWMm && m.widthMm <= p.platenHMm);
      add("platen", fits ? "pass" : "fail", `Mold ${f(m.widthMm)} × ${f(m.heightMm)} mm on platen ${f(p.platenWMm)} × ${f(p.platenHMm)} mm`);
    }
  }
  if (on.mold_height) {
    if (!has(m.stackHeightMm) || (!has(p.minMoldHeightMm) && !has(p.maxMoldHeightMm))) missing("mold_height", !has(m.stackHeightMm) ? "mold height" : "press mold-height range");
    else {
      const lo = p.minMoldHeightMm ?? 0;
      const hi = p.maxMoldHeightMm ?? Infinity;
      const ok = m.stackHeightMm >= lo && m.stackHeightMm <= hi;
      add("mold_height", ok ? "pass" : "fail", `Mold ${f(m.stackHeightMm)} mm; press takes ${has(p.minMoldHeightMm) ? f(p.minMoldHeightMm) : "—"}–${has(p.maxMoldHeightMm) ? f(p.maxMoldHeightMm) : "—"} mm`);
    }
  }
  if (on.opening) {
    if (!has(m.openingStrokeMm) || !has(p.maxOpeningMm)) missing("opening", !has(m.openingStrokeMm) ? "opening needed" : "press opening stroke");
    else add("opening", p.maxOpeningMm >= m.openingStrokeMm ? "pass" : "fail", `Needs ${f(m.openingStrokeMm)} mm, press opens ${f(p.maxOpeningMm)} mm`);
  }
  if (on.shot_size) {
    if (!has(m.shotWeightG) || !has(p.shotCapacityG) || p.shotCapacityG <= 0) missing("shot_size", !has(m.shotWeightG) ? "shot weight" : "press shot capacity");
    else {
      const pct = (m.shotWeightG / p.shotCapacityG) * 100;
      add("shot_size", pct >= rules.shotMinPct && pct <= rules.shotMaxPct ? "pass" : "fail", `Shot ${f(m.shotWeightG)} g is ${f(pct)}% of ${f(p.shotCapacityG)} g capacity (allowed ${rules.shotMinPct}–${rules.shotMaxPct}%)`);
    }
  }
  if (on.locating_ring) {
    if (!has(m.locatingRingMm) || !has(p.locatingRingMm)) missing("locating_ring", "locating ring diameter");
    else add("locating_ring", Math.abs(m.locatingRingMm - p.locatingRingMm) <= rules.ringTolMm ? "pass" : "fail", `Mold ${f(m.locatingRingMm, 1)} mm, press ${f(p.locatingRingMm, 1)} mm`);
  }
  if (on.nozzle) {
    if (!has(m.sprueRadiusMm) || !has(p.nozzleRadiusMm)) missing("nozzle", !has(m.sprueRadiusMm) ? "sprue bush radius" : "nozzle radius");
    else add("nozzle", p.nozzleRadiusMm <= m.sprueRadiusMm ? "pass" : "fail", `Nozzle R${f(p.nozzleRadiusMm, 1)} must not exceed sprue bush R${f(m.sprueRadiusMm, 1)}`);
  }
  if (on.hot_runner) {
    if (!has(m.hotRunnerZones) || m.hotRunnerZones === 0) add("hot_runner", "pass", "Mold has no hot runner");
    else if (!has(p.hotRunnerZones)) missing("hot_runner", "press hot-runner zone capacity");
    else add("hot_runner", p.hotRunnerZones >= m.hotRunnerZones ? "pass" : "fail", `Mold needs ${m.hotRunnerZones} zones, press controls ${p.hotRunnerZones}`);
  }
  if (on.weight) {
    if (!has(m.weightKg) || !has(p.maxMoldWeightKg)) missing("weight", !has(m.weightKg) ? "mold weight" : "press max mold weight");
    else add("weight", m.weightKg <= p.maxMoldWeightKg ? "pass" : "fail", `Mold ${f(m.weightKg)} kg, press takes up to ${f(p.maxMoldWeightKg)} kg`);
  }
  const failures = checks.filter((c) => c.result === "fail");
  return { compatible: failures.length === 0, checks, failures, unknowns: checks.filter((c) => c.result === "unknown") };
}

/** "approved" (qualified pair) beats "compatible"; any failed rule makes the pair "incompatible". */
export function pairStatus(v: Verdict, approved: boolean): "approved" | "compatible" | "incompatible" {
  if (!v.compatible) return "incompatible";
  return approved ? "approved" : "compatible";
}
