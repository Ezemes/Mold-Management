import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, needsApproval, reconcileHandovers, HANDOVER_CHECKLIST } from "../transfers.pure";
import { checklistSummary, maintenanceMetrics, parseTaskLines, planState, taskLines } from "../maintenance.pure";

test("transfers: state machine allows only valid steps", () => {
  assert.ok(canTransition("draft", "submit"));
  assert.ok(canTransition("requested", "approve"));
  assert.ok(canTransition("approved", "ship"));
  assert.ok(canTransition("in_transit", "receive"));
  assert.ok(canTransition("disputed", "resolve"));
  assert.ok(!canTransition("draft", "ship"));
  assert.ok(!canTransition("in_transit", "cancel"), "cannot cancel once shipped");
  assert.ok(!canTransition("completed", "receive"));
  assert.ok(!canTransition("requested", "receive"));
});

test("transfers: approval policy", () => {
  assert.equal(needsApproval("cross_company", null, "p1"), true);
  assert.equal(needsApproval("cross_company", null, null), false);
  assert.equal(needsApproval("cross_company", "p1", "p1"), false);
  assert.equal(needsApproval("always", null, null), true);
  assert.equal(needsApproval("never", null, "p1"), false);
});

const ok = HANDOVER_CHECKLIST.map((c) => ({ ...c, ok: true, note: "" }));
test("transfers: reconciliation flags shot gaps, new condition issues and missing accessories", () => {
  const out = { lifetimeShots: 100000, conditionOk: true, checklist: ok, accessories: "2 lifting eyes, hot-runner cable" };
  assert.deepEqual(reconcileHandovers(out, { lifetimeShots: 100030, conditionOk: true, checklist: ok, accessoriesComplete: true }, 50), []);
  const ran = reconcileHandovers(out, { lifetimeShots: 104000, conditionOk: true, checklist: ok, accessoriesComplete: true }, 50);
  assert.equal(ran[0].kind, "shot_mismatch");
  assert.match(ran[0].detail, /4,000 shots/);
  assert.equal(reconcileHandovers(out, { lifetimeShots: 99000, conditionOk: true, checklist: ok, accessoriesComplete: true }, 50)[0].kind, "shot_mismatch");
  const damaged = ok.map((c) => (c.key === "parting_line" ? { ...c, ok: false, note: "dent near gate" } : c));
  const f = reconcileHandovers(out, { lifetimeShots: 100000, conditionOk: false, checklist: damaged, accessoriesComplete: false }, 50);
  assert.deepEqual(f.map((x) => x.kind), ["condition", "missing_accessories"]);
  assert.match(f[0].detail, /dent near gate/);
  // an issue already recorded at dispatch is not a new finding
  const outDamaged = { ...out, checklist: damaged };
  assert.deepEqual(reconcileHandovers(outDamaged, { lifetimeShots: 100000, conditionOk: true, checklist: damaged, accessoriesComplete: true }, 50), []);
});

test("maintenance: task lines round-trip", () => {
  const tasks = parseTaskLines("Clean parting line\nmeasure: Ejector pin wear [mm] (0-0.05)\nphoto: Photo of cavity side\n* Check vents");
  assert.deepEqual(tasks.map((t) => [t.type, t.required]), [["check", true], ["measure", true], ["photo", true], ["check", false]]);
  assert.equal(tasks[1].unit, "mm");
  assert.equal(tasks[1].max, 0.05);
  assert.deepEqual(parseTaskLines(taskLines(tasks)).map((t) => t.text), tasks.map((t) => t.text));
});

test("maintenance: checklist summary — measurement out of range fails, required items enforced", () => {
  const t = parseTaskLines("Clean\nmeasure: Wear [mm] (0-0.05)\n* Optional");
  const s = checklistSummary([{ ...t[0], result: "pass" }, { ...t[1], result: "pass", value: 0.08 }, { ...t[2], result: null }]);
  assert.equal(s.failed.length, 1);
  assert.equal(s.missing.length, 0);
  assert.equal(s.passPct, 50);
  assert.equal(checklistSummary([{ ...t[0], result: null }, { ...t[1], result: "pass", value: null }, { ...t[2], result: null }]).missing.length, 2);
});

test("maintenance: shot and calendar plan states with lead time", () => {
  const p = { triggerType: "shots", interval: 50000, leadPct: 90, baselineShots: 100000, baselineDate: new Date("2026-01-01") };
  assert.equal(planState(p, 140000).status, "ok");
  assert.equal(planState(p, 145000).status, "due_soon");
  assert.equal(planState(p, 150000).status, "due");
  assert.equal(planState(p, 150000).dueAtShots, 150000);
  const d = { triggerType: "days", interval: 30, leadPct: 90, baselineShots: 0, baselineDate: new Date("2026-10-01T00:00:00Z") };
  assert.equal(planState(d, null, new Date("2026-10-20T00:00:00Z")).status, "ok");
  assert.equal(planState(d, null, new Date("2026-10-29T00:00:00Z")).status, "due_soon");
  assert.equal(planState(d, null, new Date("2026-10-31T00:00:00Z")).status, "due");
});

test("maintenance: compliance, MTTR, MTBF", () => {
  const D = (s: string) => new Date(s);
  const wos = [
    { type: "preventive", status: "completed", createdAt: D("2026-09-01"), completedAt: D("2026-09-10"), dueDate: D("2026-09-10"), assetId: "a" },
    { type: "preventive", status: "completed", createdAt: D("2026-09-01"), completedAt: D("2026-09-20"), dueDate: D("2026-09-15"), assetId: "a" },
    { type: "corrective", status: "completed", createdAt: D("2026-09-05T00:00:00Z"), completedAt: D("2026-09-05T06:00:00Z"), dueDate: null, assetId: "b" },
    { type: "corrective", status: "open", createdAt: D("2026-09-25"), completedAt: null, dueDate: D("2026-09-26"), assetId: "b" },
  ];
  const m = maintenanceMetrics(wos, D("2026-09-01"), D("2026-09-30"), 2);
  assert.equal(m.pmCompliancePct, 50);
  assert.equal(m.mttrHours, 6);
  assert.equal(m.failures, 2);
  assert.equal(m.overdue, 1);
});
