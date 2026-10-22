import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFormula, evalFormula } from "../formula";
import { computeReading, ReadingError } from "../meters.pure";

test("formula: arithmetic, precedence, functions, nulls", () => {
  assert.equal(evalFormula("active_cavities * 3600 / design_cycle_time_s", { active_cavities: 8, design_cycle_time_s: 24 }), 1200);
  assert.equal(evalFormula("2 + 3 * 4", {}), 14);
  assert.equal(evalFormula("(2 + 3) * 4", {}), 20);
  assert.equal(evalFormula("-x + 1", { x: 3 }), -2);
  assert.equal(evalFormula("round(10 / 3, 2)", {}), 3.33);
  assert.equal(evalFormula("max(a, b, 7)", { a: 2, b: 9 }), 9);
  assert.equal(evalFormula("a / 0", { a: 1 }), null);
  assert.equal(evalFormula("missing * 2", {}), null);
  assert.deepEqual(compileFormula("a + b * a").refs.sort(), ["a", "b"]);
});

test("formula: rejects anything but arithmetic", () => {
  for (const bad of ["process.exit()", "a.b", "a;b", "constructor('x')", "1 +", "eval(1)", "a[0]", "`x`"]) {
    assert.throws(() => compileFormula(bad), bad);
    assert.equal(evalFormula(bad, { a: 1 }), null);
  }
});

const t0 = new Date("2026-10-01T00:00:00Z");
const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const fresh = { offset: 0, lastRawValue: null, lastReadingAt: null, lifetimeTotal: 0 };

test("readings: baseline, increase, delta", () => {
  const a = computeReading(fresh, { rawValue: 50000, readAt: t0, source: "manual" }, later(1));
  assert.deepEqual(a, { offset: 0, delta: 0, lifetime: 50000 });
  const b = computeReading({ offset: 0, lastRawValue: 50000, lastReadingAt: t0, lifetimeTotal: 50000 }, { rawValue: 51000, readAt: later(24), source: "manual" }, later(25));
  assert.deepEqual(b, { offset: 0, delta: 1000, lifetime: 51000 });
});

test("readings: lower value rejected unless reset with reason; lifetime stays continuous", () => {
  const m = { offset: 0, lastRawValue: 80000, lastReadingAt: t0, lifetimeTotal: 80000 };
  assert.throws(() => computeReading(m, { rawValue: 100, readAt: later(10), source: "manual" }, later(11)), (e: unknown) => e instanceof ReadingError && e.code === "backwards");
  assert.throws(() => computeReading(m, { rawValue: 100, readAt: later(10), source: "manual", isReset: true }, later(11)), ReadingError);
  const r = computeReading(m, { rawValue: 100, readAt: later(10), source: "manual", isReset: true, resetReason: "Counter replaced" }, later(11));
  assert.deepEqual(r, { offset: 80000, delta: 100, lifetime: 80100 });
});

test("readings: backdated, future and implausible values", () => {
  const m = { offset: 0, lastRawValue: 1000, lastReadingAt: later(10), lifetimeTotal: 1000 };
  assert.throws(() => computeReading(m, { rawValue: 1200, readAt: later(5), source: "manual" }, later(20)), (e: unknown) => (e as ReadingError).code === "backdated");
  assert.throws(() => computeReading(m, { rawValue: 1200, readAt: later(30), source: "manual" }, later(20)), (e: unknown) => (e as ReadingError).code === "future");
  // 1 hour at a 30 s cycle is ~120 shots; 50,000 is implausible
  assert.throws(() => computeReading(m, { rawValue: 51000, readAt: later(11), source: "manual", cycleTimeS: 30 }, later(12)), (e: unknown) => (e as ReadingError).code === "implausible");
  assert.equal(computeReading(m, { rawValue: 51000, readAt: later(11), source: "manual", cycleTimeS: 30, confirmHigh: true }, later(12)).delta, 50000);
  assert.equal(computeReading(m, { rawValue: 1100, readAt: later(11), source: "manual", cycleTimeS: 30 }, later(12)).delta, 100);
});
