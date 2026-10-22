import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../reconcile.pure";
import { checkWebhookUrl, isPrivateAddress, nextAttempt, signPayload, verifySignature } from "../webhooks.pure";

const d = (s: string) => new Date(s + "T06:00:00Z");
const o = { tolerancePct: 5, minShots: 200, windowDays: 3 };

test("reconcile: counter shots vs parts ÷ cavities within tolerance", () => {
  const readings = [{ readAt: d("2026-10-01"), lifetime: 100_000 }, { readAt: d("2026-10-08"), lifetime: 110_000 }];
  const ok = reconcile({ periodStart: d("2026-10-01"), periodEnd: d("2026-10-08"), parts: 40_400 }, readings, 4, o);
  assert.equal(ok.status, "matched"); // 10,100 expected vs 10,000 counted: gap −100 ≤ 505
  const bad = reconcile({ periodStart: d("2026-10-01"), periodEnd: d("2026-10-08"), parts: 32_000 }, readings, 4, o);
  assert.equal(bad.status, "exception");
  if (bad.status === "exception") { assert.equal(bad.gap, 2_000); assert.equal(bad.gapPct, 25); }
});

test("reconcile: waits for readings, then gives up; needs cavities", () => {
  const r = [{ readAt: d("2026-10-01"), lifetime: 0 }];
  const p = { periodStart: d("2026-10-01"), periodEnd: d("2026-10-08"), parts: 100 };
  assert.equal(reconcile(p, r, 4, o, d("2026-10-09")).status, "pending");
  assert.equal(reconcile(p, r, 4, o, d("2026-11-20")).status, "unverifiable");
  assert.equal(reconcile(p, r, 0, o).status, "unverifiable");
  // A reading 2 days off still counts; 4 days off does not.
  const near = [{ readAt: d("2026-09-29"), lifetime: 0 }, { readAt: d("2026-10-08"), lifetime: 25 }];
  assert.equal(reconcile(p, near, 4, o).status, "matched");
  assert.equal(reconcile(p, [{ readAt: d("2026-09-27"), lifetime: 0 }, near[1]], 4, o, d("2026-10-09")).status, "pending");
});

test("webhooks: signature round-trip, tolerance and tampering", () => {
  const body = JSON.stringify({ id: "e1", type: "ping" });
  const h = signPayload("s3cret", body, 1_800_000_000);
  assert.match(h, /^t=1800000000,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature("s3cret", body, h, 300, 1_800_000_100), true);
  assert.equal(verifySignature("s3cret", body + " ", h, 300, 1_800_000_100), false);
  assert.equal(verifySignature("other", body, h, 300, 1_800_000_100), false);
  assert.equal(verifySignature("s3cret", body, h, 300, 1_800_001_000), false); // too old
});

test("webhooks: backoff schedule and private-address guard", () => {
  const now = new Date(0);
  assert.equal(nextAttempt(1, now)!.getTime(), 60_000);
  assert.equal(nextAttempt(6, now)!.getTime(), 86_400_000);
  assert.equal(nextAttempt(7, now), null);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "nonsense"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "13.235.1.1", "2606:4700::1111", "172.32.0.1"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(checkWebhookUrl("http://example.com/x"), "Webhook URLs must use https.");
  assert.equal(checkWebhookUrl("http://example.com/x", true), null);
  assert.match(checkWebhookUrl("https://u:p@example.com")!, /credentials/);
  assert.equal(checkWebhookUrl("https://example.com/hook"), null);
});

import { emailDomain, groupsFrom, parseDomains, parseMappingLines, resolveAccess, safeReturnTo, validDomain } from "../sso.pure";

test("sso: domains, return paths and group claims", () => {
  assert.equal(emailDomain("Asha@Sharma.Example"), "sharma.example");
  assert.deepEqual(parseDomains("sharma.example, @SHARMA.example\nplant.sharma.example"), ["sharma.example", "plant.sharma.example"]);
  assert.equal(validDomain("sharma.example"), true);
  assert.equal(validDomain("localhost"), false);
  assert.equal(safeReturnTo("/assets/1"), "/assets/1");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", null]) assert.equal(safeReturnTo(bad), "/dashboard");
  assert.deepEqual(groupsFrom(["a", "b"]), ["a", "b"]);
  assert.deepEqual(groupsFrom("a, b"), ["a", "b"]);
  assert.deepEqual(groupsFrom(undefined), []);
});

test("sso: mapping lines and first-match access", () => {
  const { lines, errors } = parseMappingLines("PM-Admins | Org Admin\n# comment\nPM-Pune | Technician | sites: PUN1, PUN-TS\nBrightway | Supplier Admin | partner: Brightway Plastics\nbad line\nX | Viewer | planet: Mars");
  assert.equal(lines.length, 3);
  assert.equal(errors.length, 2);
  assert.deepEqual(lines[1], { group: "PM-Pune", role: "Technician", scopeType: "sites", refs: ["PUN1", "PUN-TS"] });
  const maps = [
    { group: "PM-Admins", roleId: "r-admin", scopeType: "all" as const, scopeIds: [], partnerId: null },
    { group: "PM-Pune", roleId: "r-tech", scopeType: "sites" as const, scopeIds: ["s1"], partnerId: null },
  ];
  assert.equal(resolveAccess(["pm-pune", "PM-Admins"], maps, null)!.roleId, "r-admin"); // first mapping wins
  assert.equal(resolveAccess(["PM-Pune"], maps, null)!.roleId, "r-tech");
  assert.equal(resolveAccess(["Other"], maps, null), null);
  assert.equal(resolveAccess(["Other"], maps, "r-viewer")!.roleId, "r-viewer");
});
