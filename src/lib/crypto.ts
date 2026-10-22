import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Key for secrets stored in the database (webhook signing secrets, OIDC client secrets). */
function dataKey() {
  const base = process.env.DATA_KEY || process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("AUTH_SECRET (or DATA_KEY) must be set (32+ chars)");
  return Buffer.from(hkdfSync("sha256", base, "plant-metrics", "secrets-at-rest-v1", 32));
}

/** AES-256-GCM; output is "v1:<iv>:<tag>:<ciphertext>" in base64url. */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(enc: string) {
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== "v1" || !iv || !tag || ct == null) throw new Error("Unreadable secret");
  const d = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
