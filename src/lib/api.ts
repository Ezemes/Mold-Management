import "server-only";
import type { ApiKey, Organisation, Prisma } from "@prisma/client";
import { db } from "./db";
import { randomToken, safeEqual, sha256 } from "./crypto";

export { API_SCOPES, type ApiScope } from "./api-scopes";
import type { ApiScope } from "./api-scopes";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export type ApiCtx = { key: ApiKey; org: Organisation };

/** Issue a key; the full token is returned once and never stored. */
export async function createApiKey(orgId: string, name: string, scopes: ApiScope[], siteIds: string[], createdById: string, expiresAt: Date | null) {
  const prefix = randomToken(6).replace(/[-_]/g, "x");
  const secret = randomToken(32);
  const key = await db.apiKey.create({ data: { orgId, name, prefix, hash: sha256(secret), scopes, siteIds, createdById, expiresAt } });
  return { key, token: `pmk_${prefix}_${secret}` };
}

// A simple per-process limiter; behind several app instances, put a shared limit at the load balancer as well.
const WINDOW_MS = 60_000;
const LIMIT = 600;
const hits = new Map<string, number[]>();
function rateLimit(keyId: string) {
  const now = Date.now();
  const recent = (hits.get(keyId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) throw new ApiError(429, "rate_limited", `Rate limit is ${LIMIT} requests per minute per key.`, { retry_after_s: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) });
  recent.push(now);
  hits.set(keyId, recent);
}

async function authenticate(req: Request): Promise<ApiCtx> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+pmk_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/);
  if (!m) throw new ApiError(401, "unauthenticated", "Send an API key as “Authorization: Bearer pmk_…”.");
  const key = await db.apiKey.findUnique({ where: { prefix: m[1] }, include: { org: true } });
  if (!key || !safeEqual(sha256(m[2]), key.hash)) throw new ApiError(401, "unauthenticated", "Invalid API key.");
  if (key.revokedAt) throw new ApiError(401, "key_revoked", "This API key has been revoked.");
  if (key.expiresAt && key.expiresAt < new Date()) throw new ApiError(401, "key_expired", "This API key has expired.");
  if (key.org.status !== "active") throw new ApiError(403, "org_suspended", "The organisation is suspended.");
  rateLimit(key.id);
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  const { org, ...rest } = key;
  return { key: rest as ApiKey, org };
}

function problem(e: ApiError, requestId: string) {
  const headers: Record<string, string> = { "X-Request-Id": requestId };
  if (e.status === 429) headers["Retry-After"] = String((e.details as { retry_after_s: number }).retry_after_s);
  return Response.json({ error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } }, { status: e.status, headers });
}

/** Wrap a v1 route: authenticate, check the scope, turn errors into JSON problems. */
export function apiRoute<P>(scope: ApiScope, fn: (req: Request, ctx: ApiCtx, params: P) => Promise<unknown>) {
  return async (req: Request, { params }: { params: Promise<P> }) => {
    const requestId = randomToken(9);
    try {
      const ctx = await authenticate(req);
      if (!ctx.key.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `This key lacks the “${scope}” scope.`);
      const body = await fn(req, ctx, await params);
      return body instanceof Response ? body : Response.json(body, { headers: { "X-Request-Id": requestId } });
    } catch (e) {
      if (e instanceof ApiError) return problem(e, requestId);
      console.error(`[api ${requestId}]`, e);
      return problem(new ApiError(500, "internal_error", "Something went wrong. Quote the request id if you contact support."), requestId);
    }
  };
}

/** Parse a JSON body (max 1 MB). */
export async function jsonBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) throw new ApiError(413, "too_large", "Request body is limited to 1 MB.");
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new ApiError(415, "unsupported_media_type", "Send Content-Type: application/json.");
  const text = await req.text();
  if (text.length > 1_000_000) throw new ApiError(413, "too_large", "Request body is limited to 1 MB.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

/** Assets the key may see: the whole organisation or, if the key is restricted, its sites. */
export function keyAssetScope(ctx: ApiCtx): Prisma.AssetWhereInput {
  return { orgId: ctx.org.id, deletedAt: null, ...(ctx.key.siteIds.length ? { siteId: { in: ctx.key.siteIds } } : {}) };
}

/** Transfers the key may see: those leaving or arriving at its sites. */
export function keyTransferScope(ctx: ApiCtx): Prisma.TransferWhereInput {
  const s = ctx.key.siteIds;
  return { orgId: ctx.org.id, ...(s.length ? { OR: [{ fromSiteId: { in: s } }, { toSiteId: { in: s } }] } : {}) };
}

export function pageParams(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(raw) && raw >= 1 && raw <= 200 ? raw : 50;
  const cursor = url.searchParams.get("cursor");
  return { take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), limit };
}

export function page<T extends { id: string }>(rows: T[], limit: number, map: (r: T) => unknown) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { data: items.map(map), next_cursor: more ? items[items.length - 1].id : null };
}

export function dateParam(url: URL, name: string): Date | undefined {
  const v = url.searchParams.get(name);
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new ApiError(400, "invalid_parameter", `“${name}” must be an ISO 8601 date-time.`);
  return d;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
