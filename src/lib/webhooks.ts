import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { DISABLE_AFTER_FAILURES, isPrivateAddress, nextAttempt, signPayload, type EventType } from "./webhooks.pure";

export * from "./webhooks.pure";

const allowHttp = () => process.env.WEBHOOK_ALLOW_HTTP === "1";
const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === "1";

/**
 * Record a business event and queue a delivery to every endpoint subscribed to it. A repeated dedupe key
 * is ignored. Deliveries are attempted straight away (after the caller's transaction) and retried by the job.
 */
export async function emitEvent(orgId: string, type: EventType, data: Record<string, unknown>, opts: { dedupeKey?: string; tx?: Prisma.TransactionClient } = {}) {
  const client = opts.tx ?? db;
  // skipDuplicates (ON CONFLICT DO NOTHING) keeps a surrounding transaction usable when the key repeats.
  const [ev] = await client.outboundEvent.createManyAndReturn({ data: [{ orgId, type, data: data as Prisma.InputJsonValue, dedupeKey: opts.dedupeKey ?? null }], skipDuplicates: true });
  if (!ev) return null;
  const eventId = ev.id;
  const endpoints = await client.webhookEndpoint.findMany({ where: { orgId, active: true, ...(type === "ping" ? {} : { events: { has: type } }) }, select: { id: true } });
  if (endpoints.length) await client.webhookDelivery.createMany({ data: endpoints.map((e) => ({ eventId, endpointId: e.id })) });
  if (!opts.tx && endpoints.length) kick();
  return eventId;
}

/** Start sending due deliveries without making the caller wait. */
export function kick() {
  void dispatchDue().catch((e) => console.error("webhook dispatch failed", e));
}

/**
 * Resolve the host and refuse private addresses at connection time, so DNS changes can't redirect a webhook
 * inward. Node may ask for one address or (with `all: true`, used for Happy Eyeballs) for all of them.
 */
function guardedLookup(hostname: string, options: { all?: boolean }, cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void) {
  lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0);
    const blocked = !allowPrivate() && addresses.find((a) => isPrivateAddress(a.address));
    if (blocked) return cb(Object.assign(new Error(`Refusing to connect to private address ${blocked.address}`), { code: "EPRIVATE" }), "", 0);
    if (options?.all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}

function post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(allowHttp() && u.protocol === "http:")) return reject(new Error("Webhook URLs must use https"));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) }, lookup: guardedLookup as never, timeout: 10_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (text.length < 2000) text += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("timeout", () => req.destroy(new Error("Timed out after 10 s")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Send one delivery now. Returns true when the receiver answered 2xx. Redirects are not followed. */
async function send(deliveryId: string) {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { event: true, endpoint: true } });
  if (!d || d.status === "delivered") return true;
  const body = JSON.stringify({ id: d.event.id, type: d.event.type, created_at: d.event.createdAt.toISOString(), data: d.event.data });
  let status: number | null = null;
  let error = "";
  try {
    const res = await post(d.endpoint.url, body, {
      "Content-Type": "application/json",
      "User-Agent": "PlantMetrics-Webhooks/1",
      "X-PM-Event": d.event.type,
      "X-PM-Event-Id": d.event.id,
      "X-PM-Delivery": d.id,
      "X-PM-Signature": signPayload(decryptSecret(d.endpoint.secretEnc), body),
    });
    status = res.status;
    if (status < 200 || status >= 300) error = `HTTP ${status}${res.text ? `: ${res.text.slice(0, 200)}` : ""}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  const attempts = d.attempts + 1;
  if (!error) {
    await db.$transaction([
      db.webhookDelivery.update({ where: { id: d.id }, data: { status: "delivered", attempts, lastStatusCode: status, lastError: "", deliveredAt: new Date() } }),
      db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: 0 } }),
    ]);
    return true;
  }
  const next = nextAttempt(attempts);
  const failures = d.endpoint.consecutiveFailures + 1;
  await db.$transaction([
    db.webhookDelivery.update({ where: { id: d.id }, data: { status: next ? "pending" : "failed", attempts, lastStatusCode: status, lastError: error, ...(next ? { nextAttemptAt: next } : {}) } }),
    db.webhookEndpoint.update({
      where: { id: d.endpointId },
      data: { consecutiveFailures: failures, ...(failures >= DISABLE_AFTER_FAILURES ? { active: false, disabledReason: `Disabled after ${failures} failed deliveries in a row. Last error: ${error}` } : {}) },
    }),
  ]);
  return false;
}

/** Claim and send due deliveries. Claiming pushes nextAttemptAt forward, so parallel runs never double-send. */
export async function dispatchDue(limit = 50) {
  const due = await db.webhookDelivery.findMany({ where: { status: "pending", nextAttemptAt: { lte: new Date() }, endpoint: { active: true } }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: { id: true, nextAttemptAt: true } });
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    const claimed = await db.webhookDelivery.updateMany({ where: { id: d.id, status: "pending", nextAttemptAt: d.nextAttemptAt }, data: { nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
    if (!claimed.count) continue;
    if (await send(d.id)) sent++;
    else failed++;
  }
  return { due: due.length, sent, failed };
}

/** Send one delivery again now (from the admin screen), whatever its state. */
export async function redeliver(deliveryId: string) {
  await db.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "pending", nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
  return send(deliveryId);
}
