import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { can, normalizePermissions, type Action, type Module, type Permissions } from "./permissions";

const COOKIE = "pm_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string | null) {
  return hash ? bcrypt.compare(pw, hash) : false;
}

export function validPassword(pw: string) {
  return pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}
export const PASSWORD_RULE = "At least 10 characters, including a letter and a number.";

export async function createSession(uid: string, oid: string | null) {
  const token = await new SignJWT({ uid, oid }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

async function readSession(): Promise<{ uid: string; oid: string | null } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: String(payload.uid), oid: (payload.oid as string | null) ?? null };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const s = await readSession();
  if (!s) return null;
  const user = await db.user.findUnique({ where: { id: s.uid } });
  if (!user || user.status !== "active") return null;
  return { user, orgId: s.oid };
}

export async function requireUser() {
  const cur = await getCurrentUser();
  if (!cur) redirect("/login");
  return cur;
}

export type Scope = { type: "all" | "sites" | "divisions" | "partner"; ids: string[]; partnerId: string | null };

export type Ctx = NonNullable<Awaited<ReturnType<typeof loadCtx>>>;

async function loadCtx(userId: string, orgId: string) {
  const m = await db.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    include: { role: true, org: true, partner: true, user: true },
  });
  if (!m || m.status !== "active" || m.org.status !== "active") return null;
  const perms: Permissions = normalizePermissions(m.role.permissions);
  const scope: Scope = m.role.isSupplier || m.scopeType === "partner"
    ? { type: "partner", ids: [], partnerId: m.partnerId }
    : { type: (["all", "sites", "divisions"].includes(m.scopeType) ? m.scopeType : "all") as Scope["type"], ids: m.scopeIds, partnerId: null };
  return {
    user: m.user,
    org: m.org,
    membership: m,
    role: m.role,
    perms,
    scope,
    isSupplier: m.role.isSupplier,
    can: (module: Module, action: Action = "view") => can(perms, module, action),
  };
}

/** Organisation context for app pages. Optionally requires a permission. */
export async function requireOrg(need?: [Module, Action?]) {
  const { user, orgId } = await requireUser();
  let oid = orgId;
  if (!oid) {
    const first = await db.membership.findFirst({ where: { userId: user.id, status: "active" }, orderBy: { createdAt: "asc" } });
    if (!first) redirect(user.platformRole === "platform_operator" ? "/platform" : "/onboarding");
    oid = first.orgId;
  }
  const ctx = await loadCtx(user.id, oid);
  if (!ctx) redirect(`/login?error=${encodeURIComponent("You no longer have access to that organisation.")}`);
  if (need && !ctx.can(need[0], need[1] ?? "view")) redirect("/dashboard?error=forbidden");
  return ctx;
}

/** Throws instead of redirecting — for server actions that must not leak data on failure. */
export function assertCan(ctx: Ctx, module: Module, action: Action) {
  if (!ctx.can(module, action)) throw new Error(`Not allowed: ${module}.${action}`);
}

/** Restrict asset queries to what the user may see. Always combine with other filters via AND. */
export function assetScope(ctx: Ctx): Prisma.AssetWhereInput {
  const base: Prisma.AssetWhereInput = { orgId: ctx.org.id, deletedAt: null };
  switch (ctx.scope.type) {
    case "partner":
      return { ...base, custodianPartnerId: ctx.scope.partnerId ?? "__none__" };
    case "sites":
      return { ...base, siteId: { in: ctx.scope.ids } };
    case "divisions":
      return { ...base, site: { divisionId: { in: ctx.scope.ids } } };
    default:
      return base;
  }
}

export function siteScope(ctx: Ctx): Prisma.SiteWhereInput {
  const base: Prisma.SiteWhereInput = { orgId: ctx.org.id };
  switch (ctx.scope.type) {
    case "partner":
      return { ...base, partnerId: ctx.scope.partnerId ?? "__none__" };
    case "sites":
      return { ...base, id: { in: ctx.scope.ids } };
    case "divisions":
      return { ...base, divisionId: { in: ctx.scope.ids } };
    default:
      return base;
  }
}

/** Load one asset the user may see, or null. */
export async function findScopedAsset(ctx: Ctx, id: string) {
  return db.asset.findFirst({ where: { AND: [assetScope(ctx), { id }] } });
}
