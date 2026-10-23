import { test } from "node:test";
import assert from "node:assert/strict";
import { coveredHours, DEFAULT_CODES, downtimeMetrics, fmtDuration, validateDowntime, type DtEvent } from "../downtime.pure";

const T0 = new Date("2026-10-01T00:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const now = at(240); // 10 days in

test("downtime: validation", () => {
  assert.equal(validateDowntime({ startedAt: at(10), endedAt: at(12) }, [], now), null);
  assert.match(validateDowntime({ startedAt: at(10), endedAt: at(9) }, [], now)!, /after the start/);
  assert.match(validateDowntime({ startedAt: at(241), endedAt: null }, [], now)!, /future/);
  assert.match(validateDowntime({ startedAt: at(10), endedAt: at(260) }, [], now)!, /future/);
  // a few minutes of clock drift is fine
  assert.equal(validateDowntime({ startedAt: new Date(now.getTime() + 60_000), endedAt: null }, [], now), null);
  const others = [{ number: "DT-00001", startedAt: at(20), endedAt: at(30) }];
  assert.match(validateDowntime({ startedAt: at(25), endedAt: at(35) }, others, now)!, /overlaps DT-00001/);
  assert.match(validateDowntime({ startedAt: at(15), endedAt: null }, others, now)!, /overlaps DT-00001/);
  assert.equal(validateDowntime({ startedAt: at(30), endedAt: at(31) }, others, now), null, "touching is not overlapping");
  assert.match(validateDowntime({ startedAt: at(100), endedAt: at(101) }, [{ number: "DT-00002", startedAt: at(50), endedAt: null }], now)!, /still open/);
});

test("downtime: covered hours merges overlaps and clips to the period", () => {
  const ivs = [{ startedAt: at(0), endedAt: at(10) }, { startedAt: at(5), endedAt: at(15) }, { startedAt: at(20), endedAt: null }];
  assert.equal(coveredHours(ivs, at(0), at(240), now), 15 + 220);
  assert.equal(coveredHours(ivs, at(8), at(12), now), 4);
  assert.equal(coveredHours([], at(0), at(10), now), 0);
});

test("downtime: MTBF, MTTR and availability", () => {
  const ev = (assetId: string, category: string, s: number, e: number | null, codeId = category): DtEvent => ({ assetId, category, codeId, startedAt: at(s), endedAt: e == null ? null : at(e) });
  const events = [
    ev("a", "failure", 10, 14),
    ev("a", "failure", 100, 106),
    ev("a", "planned", 150, 160),
    ev("a", "external", 200, 230),
    ev("b", "failure", 230, null),
  ];
  const m = downtimeMetrics([{ id: "a", trackedFrom: at(-1000) }, { id: "b", trackedFrom: at(120) }], events, at(0), at(500), now);
  const a = m.perAsset.get("a")!;
  assert.equal(a.periodHours, 240, "period ends now, not at the future end date");
  assert.equal(a.failures, 2);
  assert.equal(a.mttrHours, 5);
  assert.equal(a.moldDownHours, 20);
  assert.equal(a.externalHours, 30);
  assert.equal(a.mtbfHours, 110);
  assert.ok(Math.abs(a.availabilityPct! - (220 / 240) * 100) < 1e-9, "external time does not reduce availability");
  const b = m.perAsset.get("b")!;
  assert.equal(b.periodHours, 120, "tracked from when its passport was created");
  assert.equal(b.failures, 1);
  assert.equal(b.repairs, 0);
  assert.equal(b.mttrHours, null, "an open failure has no repair time yet");
  assert.equal(b.openNow, 1);
  assert.equal(m.total.failures, 3);
  assert.equal(m.total.mtbfHours, (220 + 110) / 3);
  assert.equal(m.byCode[0].codeId, "external");
  assert.equal(m.byCode[0].hours, 30);
});

test("downtime: no failures means no MTBF, full availability with no events", () => {
  const m = downtimeMetrics([{ id: "a", trackedFrom: at(-10) }], [], at(0), at(100), now);
  assert.equal(m.total.mtbfHours, null);
  assert.equal(m.total.availabilityPct, 100);
});

test("downtime: duration format and default codes", () => {
  assert.equal(fmtDuration(0.5), "30 min");
  assert.equal(fmtDuration(3 + 20 / 60), "3 h 20 min");
  assert.equal(fmtDuration(52), "2 d 4 h");
  assert.equal(fmtDuration(null), "—");
  assert.equal(new Set(DEFAULT_CODES.map((c) => c.code)).size, DEFAULT_CODES.length);
  for (const c of ["failure", "planned", "external"]) assert.ok(DEFAULT_CODES.some((d) => d.category === c));
});
