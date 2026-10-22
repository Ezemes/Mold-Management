import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompat, normalizeRules, pairStatus, DEFAULT_RULES, type MoldSpec, type PressSpec } from "../compat.pure";

const mold: MoldSpec = { clampTonnageT: 450, widthMm: 600, heightMm: 700, stackHeightMm: 550, openingStrokeMm: 400, shotWeightG: 900, locatingRingMm: 125, sprueRadiusMm: 15.5, hotRunnerZones: 8, weightKg: 1800 };
const press: PressSpec = { clampTonnageT: 500, tieBarHMm: 710, tieBarVMm: 710, platenWMm: 1050, platenHMm: 1050, minMoldHeightMm: 300, maxMoldHeightMm: 750, maxOpeningMm: 700, shotCapacityG: 1500, locatingRingMm: 125, nozzleRadiusMm: 15, hotRunnerZones: 12, maxMoldWeightKg: 3000 };

test("compat: acceptance 4 — a 450 t mold is excluded from a 400 t press, with the reason", () => {
  const ok = checkCompat(mold, press);
  assert.equal(ok.compatible, true);
  const v = checkCompat(mold, { ...press, clampTonnageT: 400 });
  assert.equal(v.compatible, false);
  assert.deepEqual(v.failures.map((f) => f.rule), ["tonnage"]);
  assert.equal(v.failures[0].detail, "Needs 450 t, press has 400 t");
});

test("compat: each rule fails with its own reason", () => {
  const cases: [Partial<PressSpec>, string][] = [
    [{ tieBarHMm: 550 }, "tie_bar"],
    [{ platenWMm: 650, platenHMm: 650 }, "platen"],
    [{ maxMoldHeightMm: 500 }, "mold_height"],
    [{ maxOpeningMm: 350 }, "opening"],
    [{ shotCapacityG: 1000 }, "shot_size"],
    [{ locatingRingMm: 100 }, "locating_ring"],
    [{ nozzleRadiusMm: 20 }, "nozzle"],
    [{ hotRunnerZones: 6 }, "hot_runner"],
    [{ maxMoldWeightKg: 1500 }, "weight"],
  ];
  for (const [change, rule] of cases) assert.deepEqual(checkCompat(mold, { ...press, ...change }).failures.map((f) => f.rule), [rule], rule);
});

test("compat: missing data is 'not checked', never a failure; disabled rules are skipped", () => {
  const v = checkCompat({ ...mold, stackHeightMm: null }, { ...press, nozzleRadiusMm: null });
  assert.equal(v.compatible, true);
  assert.deepEqual(v.unknowns.map((u) => u.rule).sort(), ["mold_height", "nozzle"]);
  const off = normalizeRules({ enabled: { tonnage: false } });
  assert.equal(checkCompat(mold, { ...press, clampTonnageT: 100 }, off).compatible, true);
});

test("compat: tonnage margin, shot window and rotation on the platen", () => {
  const margin = normalizeRules({ tonnageMarginPct: 20 });
  assert.equal(checkCompat(mold, press, margin).failures[0]?.rule, "tonnage"); // needs 540 t
  assert.equal(checkCompat({ ...mold, shotWeightG: 200 }, press).failures[0]?.rule, "shot_size"); // 13% < 20%
  assert.equal(checkCompat({ ...mold, widthMm: 1000, heightMm: 600 }, { ...press, platenWMm: 650, platenHMm: 1050, tieBarHMm: 700 }).compatible, true); // fits rotated
  assert.equal(checkCompat({ ...mold, hotRunnerZones: 0 }, { ...press, hotRunnerZones: null }).compatible, true);
});

test("compat: rule settings are clamped and pair status ranks approved first", () => {
  const r = normalizeRules({ shotMinPct: 90, shotMaxPct: 50, ringTolMm: -1, enabled: { nozzle: "yes" } });
  assert.equal(r.shotMaxPct, 90);
  assert.equal(r.ringTolMm, DEFAULT_RULES.ringTolMm);
  assert.equal(r.enabled.nozzle, true);
  assert.equal(pairStatus(checkCompat(mold, press), true), "approved");
  assert.equal(pairStatus(checkCompat(mold, { ...press, clampTonnageT: 1 }), true), "incompatible");
});

import { currentStage, parseCriteria, qualificationOutcome, scoreBand, weightedScore } from "../quality.pure";

test("quality: criteria parsing, weighted score and bands", () => {
  const c = parseCriteria("Parting line | 3\nVents\nVents | 0\n\n");
  assert.deepEqual(c.map((x) => [x.key, x.weight]), [["parting_line", 3], ["vents", 1], ["vents_2", 1]]);
  const s = weightedScore([{ ...c[0], score: 2 }, { ...c[1], score: 5 }, { ...c[2], score: null }]);
  assert.equal(s, 2.75); // (2×3 + 5×1) / 4
  assert.equal(weightedScore([{ ...c[0], score: null }]), null);
  assert.equal(scoreBand(2.75, 3), "poor");
  assert.equal(scoreBand(3.5, 3), "watch");
  assert.equal(scoreBand(4.2, 3), "good");
});

test("quality: stages run IQ → OQ → PQ; PQ pass passes, any fail fails", () => {
  const st = (iq: string, oq: string, pq: string) => [{ stage: "IQ", status: iq }, { stage: "OQ", status: oq }, { stage: "PQ", status: pq }];
  assert.equal(currentStage(st("pending", "pending", "pending")), "IQ");
  assert.equal(currentStage(st("passed", "in_progress", "pending")), "OQ");
  assert.equal(currentStage(st("passed", "failed", "pending")), null);
  assert.equal(qualificationOutcome(st("passed", "passed", "in_progress")), "in_progress");
  assert.equal(qualificationOutcome(st("passed", "passed", "passed")), "passed");
  assert.equal(qualificationOutcome(st("passed", "failed", "pending")), "failed");
});

import { parseQty, reorderQty, stockStatus } from "../inventory.pure";

test("inventory: status, reorder quantity and quantity parsing", () => {
  assert.equal(stockStatus({ quantity: 0, minQty: 2, maxQty: 20, reorderPoint: 5 }), "out");
  assert.equal(stockStatus({ quantity: 1, minQty: 2, maxQty: 20, reorderPoint: 5 }), "below_min");
  assert.equal(stockStatus({ quantity: 5, minQty: 2, maxQty: 20, reorderPoint: 5 }), "reorder");
  assert.equal(stockStatus({ quantity: 6, minQty: 2, maxQty: 20, reorderPoint: 5 }), "ok");
  assert.equal(reorderQty({ quantity: 4, minQty: 2, maxQty: 20, reorderPoint: 5 }), 16);
  assert.equal(reorderQty({ quantity: 3, minQty: 0, maxQty: 0, reorderPoint: 5 }), 7);
  assert.equal(reorderQty({ quantity: 6, minQty: 2, maxQty: 20, reorderPoint: 5 }), 0);
  assert.equal(parseQty("1,200"), 1200);
  assert.equal(parseQty("0"), null);
  assert.equal(parseQty("0", { allowZero: true }), 0);
  assert.equal(parseQty("-3"), null);
  assert.equal(parseQty("abc"), null);
});

import { actualByCategory, budgetFromRules, capacityPlan, lifeForecast, monthKeys, moldCapacity, shotsPerMonth } from "../planning.pure";

test("planning: shots per month from the trailing 90 days", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const d = (s: string) => new Date(s + "T00:00:00Z");
  const r = [{ readAt: d("2026-05-01"), lifetime: 0 }, { readAt: d("2026-06-01"), lifetime: 100_000 }, { readAt: d("2026-09-01"), lifetime: 400_000 }, { readAt: d("2026-09-30"), lifetime: 500_000 }];
  // baseline = June 1 (last before window), last = Sep 30: 400k shots over 121 days
  assert.equal(Math.round(shotsPerMonth(r, now)!), Math.round((400_000 / 121) * 30.4375));
  assert.equal(shotsPerMonth(r.slice(0, 1), now), null);
});

test("planning: life forecast lists refurbishments within the allowed count and before EOL", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const f = lifeForecast({ lifetime: 300_000, rate: 50_000, shotsBetweenRefurbs: 200_000, lastRefurbShots: 200_000, refurbsAllowed: 2, refurbsDone: 1, endOfLifeShots: 1_000_000, warrantyShots: 250_000 }, now);
  assert.deepEqual(f.refurbs.map((x) => x.shots), [400_000]); // only one refurb left
  const days = (d: Date | null) => Math.round((d!.getTime() - now.getTime()) / 86_400_000);
  assert.equal(days(f.refurbs[0].date), 61); // 100k at 50k/month = 2 average months
  assert.equal(days(f.eol!.date), 426); // 700k / 50k = 14 average months
  assert.equal(f.warranty!.date!.getTime(), now.getTime()); // already past
  const unknown = lifeForecast({ lifetime: 0, rate: null, shotsBetweenRefurbs: null, lastRefurbShots: null, refurbsAllowed: null, refurbsDone: 0, endOfLifeShots: 1_000, warrantyShots: null }, now);
  assert.equal(unknown.eol!.date, null);
});

test("planning: budget from rules and actuals by category", () => {
  const b = budgetFromRules({ pmCostPerService: 10_000, partsPerCavity: 2_000, refurbCost: 300_000, replacementCost: 1_500_000 }, { plans: [{ triggerType: "shots", interval: 50_000 }, { triggerType: "days", interval: 182.5 }], shotsPerYear: 600_000, cavities: 4, refurbsInYear: 1, eolInYear: false });
  assert.deepEqual(b, { pm: 140_000, parts: 8_000, refurbishment: 300_000, replacement: 0, other: 0 }); // (12 + 2) services
  const a = actualByCategory([{ type: "preventive", labor: 100, parts: 50, external: 10 }, { type: "refurbishment", labor: 1000, parts: 500, external: 0 }, { type: "corrective", labor: 200, parts: 20, external: 5 }]);
  assert.deepEqual(a, { pm: 110, parts: 70, refurbishment: 1500, replacement: 0, other: 205 });
});

test("planning: capacity per mold with OEE, refurbishment downtime, EOL and family molds", () => {
  const s = { hoursPerMonth: 600, oeePct: 75, refurbDowntimeDays: 15 };
  const mold = { id: "1", number: "M-1", cycleS: 30, activeCavities: 4, products: [{ partNumber: "A", cavities: null }], refurbMonths: ["2026-11"], eolMonth: "2027-01" };
  assert.equal(moldCapacity(mold, "A", "2026-10", s), 216_000); // 4 × 120/h × 600 h × 0.75
  assert.equal(moldCapacity(mold, "A", "2026-11", s), 108_000); // half of November down
  assert.equal(moldCapacity(mold, "A", "2027-01", s), 0); // past end of life
  const family = { ...mold, refurbMonths: [], eolMonth: null, products: [{ partNumber: "L", cavities: 2 }, { partNumber: "R", cavities: 2 }] };
  assert.equal(moldCapacity(family, "L", "2026-10", s), 108_000);
  const months = monthKeys(new Date("2026-10-15T00:00:00Z"), 3);
  assert.deepEqual(months, ["2026-10", "2026-11", "2026-12"]);
  const plan = capacityPlan([{ partNumber: "A", month: "2026-11", quantity: 150_000 }], [mold], months, s);
  assert.deepEqual(plan.rows[0].shortfallMonths, ["2026-11"]);
  assert.equal(plan.rows[0].cells["2026-11"].gap, -42_000);
  assert.equal(plan.shortfalls, 1);
});

test("planning: a what-if mold adds capacity only from its start month", () => {
  const s = { hoursPerMonth: 600, oeePct: 75, refurbDowntimeDays: 15 };
  const m = { id: "w", number: "WHAT-IF", cycleS: 30, activeCavities: 4, products: [{ partNumber: "A", cavities: null }], refurbMonths: [], eolMonth: null, fromMonth: "2026-12" };
  assert.equal(moldCapacity(m, "A", "2026-11", s), 0);
  assert.equal(moldCapacity(m, "A", "2026-12", s), 216_000);
});
