/** Webhook rules: signing, retry schedule and the private-address guard. Pure functions, unit-tested. */
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const EVENT_TYPES = {
  "transfer.status_changed": "A transfer moved to a new state (requested, approved, in transit, disputed, completed, rejected, cancelled)",
  "work_order.closed": "A work order was completed or cancelled",
  "threshold.crossed": "A mold crossed a life threshold (80%/95% of warranty or end of life) or a maintenance plan fell due",
  "downtime.started": "A mold went down (a downtime event was recorded)",
  "downtime.ended": "A downtime event ended and the mold can run again",
  "reconciliation.exception": "A production report disagrees with the shot counter beyond tolerance",
} as const;
export type EventType = keyof typeof EVENT_TYPES | "ping";

/** Retry delays after each failed attempt; after the last one the delivery is marked failed. */
export const BACKOFF_S = [60, 300, 1800, 7200, 28_800, 86_400];
export const DISABLE_AFTER_FAILURES = 20;

export function nextAttempt(attempts: number, now = new Date()): Date | null {
  const d = BACKOFF_S[attempts - 1];
  return d == null ? null : new Date(now.getTime() + d * 1000);
}

/** Header value "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Receiver-side check (also used in tests and documented for integrators). */
export function verifySignature(secret: string, body: string, header: string, toleranceS = 300, now = Math.floor(Date.now() / 1000)) {
  const m = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m || Math.abs(now - Number(m[1])) > toleranceS) return false;
  return signPayload(secret, body, Number(m[1])) === header;
}

function v4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string) {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]);
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
}

/** Static checks on a webhook URL (DNS is checked again when sending). */
export function checkWebhookUrl(raw: string, allowHttp = false): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter a full URL, e.g. https://example.com/hooks/plant-metrics.";
  }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return "Webhook URLs must use https.";
  if (u.username || u.password) return "Don't put credentials in the URL; verify the signature header instead.";
  if (raw.length > 500) return "The URL is too long.";
  return null;
}
