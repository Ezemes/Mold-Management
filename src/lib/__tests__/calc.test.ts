import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, calcVars, type CalcInput } from "../calc.pure";

const base: CalcInput = {
  cycleCount: 300_000, cycleCountDate: new Date("2026-01-01T00:00:00Z"), capitalizedDate: new Date("2024-01-01T00:00:00Z"),
  refurbsAllowed: 2, refurbsCompleted: 0, shotsBetweenRefurb: 200_000, shotsAtRefurbTotal: null,
  annualVolume: 400_000, cavities: 4, activeCavities: 3, cycleTimeS: 30, utilization: 0.5, process: "Injection", costPerCavity: 16_000, estimatedCostNewTool: null,
  hoursPerShift: 8, shiftsPerDay: 3, daysPerWeek: 6, weeksPerYear: 50, oee: 0.85,
};
const days = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86_400_000;
const now = new Date("2026-03-01T00:00:00Z");

test("calc: lifecycle formulas with cycle count data", () => {
  const r = calculate(base, now).lifecycle;
  // life = (2+1) × 200,000 = 600,000; annual shots = 400,000 ÷ 4 = 100,000; (600,000 − 300,000) ÷ 100,000 = 3 years
  assert.equal(Math.round(days(r.expectedEndOfLife.value!, base.cycleCountDate!) * 100) / 100, 1095.72);
  assert.equal(r.shotsUntilRefurb.value, -100_000); // (0+1) × 200,000 − 300,000: overdue
  assert.equal(Math.round(days(r.nextRefurbishment.value!, base.cycleCountDate!) * 100) / 100, -365.24);
  assert.equal(r.refurbishmentPriority.value, "Critical");
  assert.equal(r.shotsSinceLastRefurb.value, 300_000);
  assert.equal(r.refurbsRemaining.value, 2);
  assert.equal(r.remainingLifePct.value, 50);
  assert.equal(r.calculatedReplacementCost.value, 64_000); // 16,000 × 4
  assert.equal(Math.round(r.costAverageRefurb.value!), 21_333); // replacement ÷ 3
});

test("calc: refurbishment priority bands and the capitalized-date fallback", () => {
  const consider = calculate({ ...base, refurbsCompleted: 1, shotsAtRefurbTotal: 220_000 }, now).lifecycle; // 100k shots left = 1 year after Jan 1
  assert.equal(consider.refurbishmentPriority.value, "Consider");
  assert.equal(consider.shotsSinceLastRefurb.value, 80_000);
  assert.equal(calculate({ ...base, refurbsCompleted: 1, cycleCount: 50_000 }, now).lifecycle.refurbishmentPriority.value, "Not necessary");
  const noCount = calculate({ ...base, cycleCount: null, cycleCountDate: null }, now).lifecycle;
  assert.equal(Math.round(days(noCount.expectedEndOfLife.value!, base.capitalizedDate!)), Math.round(6 * 365.24)); // 600,000 ÷ 100,000 years
  assert.equal(Math.round(days(noCount.nextRefurbishment.value!, base.capitalizedDate!)), Math.round(2 * 365.24));
  assert.match(noCount.expectedEndOfLife.note!, /Capitalized Date/);
  assert.deepEqual(noCount.remainingLifePct.missing, ["Cycle Count"]); // "Cannot calculate" without cycle count
  const done = calculate({ ...base, refurbsCompleted: 2 }, now).lifecycle;
  assert.equal(done.nextRefurbishment.value, null);
  assert.match(done.nextRefurbishment.note!, /end of life/);
  assert.equal(done.refurbsRemaining.value, 0);
});

test("calc: missing inputs are named as in the document", () => {
  const r = calculate({ ...base, annualVolume: null, process: null, hoursPerShift: null, oee: null }, now);
  assert.deepEqual(r.lifecycle.expectedEndOfLife.missing, ["Annual Volume"]);
  assert.deepEqual(r.lifecycle.calculatedReplacementCost.missing, ["Department"]);
  assert.deepEqual(r.capacity.dailyOutputCapacity.missing, ["Hours per Shift", "OEE"]);
  assert.deepEqual(r.capacity.freeAnnualCapacityPcs.missing, ["Hours per Shift", "OEE", "Annual Volume"]);
  assert.deepEqual(calculate({ ...base, process: "Thermoforming", costPerCavity: null }, now).lifecycle.calculatedReplacementCost.missing, ["Cost per cavity for “Thermoforming”"]);
  assert.equal(calculate({ ...base, process: "Two Part Epoxy" }, now).lifecycle.costAverageRefurb.value, 0);
});

test("calc: capacity formulas", () => {
  const c = calculate(base, now).capacity;
  assert.equal(c.dailyOutputCapacity.value, 9_792); // 3600 ÷ 30 × 8 × 3 × 4 × 0.85
  assert.equal(c.weeklyOutputCapacity.value, 58_752); // × 6 days
  assert.equal(c.annualOutputCapacity.value, 2_937_600); // × 50 weeks
  assert.equal(c.freeAnnualCapacityPcs.value, 2_537_600);
  assert.equal(Math.round(c.freeAnnualCapacityPct.value! * 100) / 100, 86.38);
  assert.equal(Math.round(c.calculatedUtilizationPct.value! * 100) / 100, 13.62);
  assert.equal(Math.round(c.productionDaysRequired.value! * 100) / 100, 40.85);
  assert.equal(Math.round(c.calculatedAnnualVolume.value!), 1_788_215); // 0.85 × 31,556,736 s × 0.5 × 4 ÷ 30
  assert.equal(c.actualCavitationPct.value, 75);
});

test("calc: values are exposed to custom formulas", () => {
  const v = calcVars(calculate(base, now), now);
  assert.equal(v.remaining_life_pct, 50);
  assert.equal(v.daily_output_capacity, 9_792);
  assert.equal(v.refurbs_remaining, 2);
  assert.equal(typeof v.expected_end_of_life, "number"); // days from now
});
