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

import { parseDate, readFieldValues } from "../asset-values";
import type { FieldDef } from "@prisma/client";

test("values: Indian and ISO dates, invalid dates", () => {
  assert.equal((parseDate("2026-03-31", "d") as { value: Date }).value.toISOString().slice(0, 10), "2026-03-31");
  assert.equal((parseDate("31/03/2026", "d") as { value: Date }).value.toISOString().slice(0, 10), "2026-03-31");
  assert.equal(parseDate("31/02/2026", "d").ok, false);
  assert.equal(parseDate("03-31-2026", "d").ok, false);
});

test("values: standard + custom fields with lakh grouping, picklists, required", () => {
  const def = (o: Partial<FieldDef>) => ({ id: "x", assetTypeId: "t", unit: "", options: [], formula: "", required: false, section: "", helpText: "", sortOrder: 0, archived: false, createdAt: new Date(), ...o }) as FieldDef;
  const defs = [def({ key: "grade", label: "Steel grade", type: "picklist", options: ["P20", "H13"] }), def({ key: "owner_ref", label: "Owner ref", type: "text", required: true }), def({ key: "ppm", label: "PPM", type: "formula", formula: "1" })];
  const row: Record<string, string> = { design_cavities: "8", warranty_shots: "10,00,000", cf_grade: "h13", cf_owner_ref: "PO-77" };
  const r = readFieldValues((k) => row[k], "mold", defs);
  assert.deepEqual(r.errors, []);
  assert.equal(r.std.designCavities, 8);
  assert.equal(r.std.warrantyShots, 1000000);
  assert.deepEqual(r.custom, { grade: "H13", owner_ref: "PO-77" });
  const bad = readFieldValues((k) => ({ design_cavities: "8.5", cf_grade: "S7" } as Record<string, string>)[k], "mold", defs);
  assert.equal(bad.errors.length, 3); // non-integer cavities, bad picklist, missing required
});

import { dateToLocalInput, localInputToDate } from "../format";

test("time zones: datetime-local in IST and other zones", () => {
  assert.equal(localInputToDate("2026-10-22T14:30", "Asia/Kolkata").toISOString(), "2026-10-22T09:00:00.000Z");
  assert.equal(localInputToDate("2026-07-01T09:00", "Europe/Berlin").toISOString(), "2026-07-01T07:00:00.000Z"); // CEST
  assert.equal(localInputToDate("2026-01-15T09:00", "Europe/Berlin").toISOString(), "2026-01-15T08:00:00.000Z"); // CET
  assert.equal(dateToLocalInput(new Date("2026-10-22T09:00:00Z"), "Asia/Kolkata"), "2026-10-22T14:30");
  assert.ok(Number.isNaN(localInputToDate("bad", "Asia/Kolkata").getTime()));
});

import { parseCsv, planAssetImport, planReadingImport, parseReadAt } from "../importer";

const moldType = { id: "t1", key: "mold", name: "Injection mold", kind: "mold", archived: false, fields: [] };
const lk = {
  types: [moldType],
  sites: [
    { id: "s1", name: "Pune Plant 1", code: "PUN1", partnerId: null, active: true },
    { id: "s2", name: "Brightway Chakan", code: "", partnerId: "p1", active: true },
  ],
  partners: [{ id: "p1", name: "Brightway Plastics" }],
  existing: [{ id: "a1", number: "M-0001", assetTypeId: "t1", custodianPartnerId: null, customValues: {} }],
};

test("import: CSV parsing normalises headers and BOM", () => {
  const r = parseCsv("﻿Number,Name,Design Cavities\r\nM-9,Cap,4\r\n\r\n");
  assert.deepEqual(r.header, ["number", "name", "design_cavities"]);
  assert.deepEqual(r.rows, [{ number: "M-9", name: "Cap", design_cavities: "4" }]);
});

test("import: assets create/update plans and row-level errors", () => {
  const rows = [
    { number: "M-0100", type: "mold", name: "Bezel", site: "pun1", design_cavities: "8" },
    { number: "M-0001", name: "Renamed", warranty_shots: "5,00,000" },
    { number: "M-0101", type: "mold", name: "Clip", site: "Brightway Chakan", owner: "Brightway Plastics" },
    { number: "M-0102", type: "blow", name: "X", site: "PUN1" },
    { number: "M-0001", name: "dup" },
    { number: "M-0103", type: "mold", site: "PUN1" },
    { number: "M-0001", site: "Brightway Chakan" },
  ];
  const { plans, errors } = planAssetImport(rows as unknown as Record<string, string>[], lk);
  assert.equal(plans.length, 3);
  assert.equal(plans[0].op, "create");
  assert.equal((plans[0] as { siteId: string }).siteId, "s1");
  assert.equal((plans[0] as { std: Record<string, unknown> }).std.designCavities, 8);
  assert.equal(plans[1].op, "update");
  assert.equal((plans[1] as { std: Record<string, unknown> }).std.warrantyShots, 500000);
  assert.equal((plans[2] as { custodianPartnerId: string }).custodianPartnerId, "p1");
  assert.deepEqual(errors.map((e) => e.row), [5, 6, 7, 8]);
  assert.match(errors[0].message, /unknown type/);
  assert.match(errors[1].message, /more than once/);
  assert.match(errors[2].message, /name is required/);
});

test("import: readings parsed in org time zone and validated in time order", () => {
  assert.equal(parseReadAt("15-10-2026 09:30", "Asia/Kolkata")!.toISOString(), "2026-10-15T04:00:00.000Z");
  assert.equal(parseReadAt("2026-10-15", "Asia/Kolkata")!.toISOString(), "2026-10-15T06:30:00.000Z");
  const meters = [{ meterId: "m1", assetId: "a1", number: "M-0001", offset: 0, lastRawValue: 1000, lastReadingAt: new Date("2026-10-01T00:00:00Z"), lifetimeTotal: 1000, cycleTimeS: null }];
  const rows = [
    { number: "M-0001", counter: "3,000", read_at: "2026-10-20 10:00" },
    { number: "M-0001", counter: "2,000", read_at: "2026-10-10 10:00" }, // earlier in time, listed later: sorted first
    { number: "M-0001", counter: "500", read_at: "2026-10-21 10:00" }, // backwards without reset
    { number: "M-9999", counter: "1", read_at: "2026-10-21 10:00" },
  ];
  const { plans, errors } = planReadingImport(rows, meters, "Asia/Kolkata", new Date("2026-10-22T00:00:00Z"));
  assert.deepEqual(plans.map((p) => p.rawValue), [2000, 3000]);
  assert.deepEqual(errors.map((e) => e.row), [4, 5]);
});
