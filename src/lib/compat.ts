import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { assetScope, type Ctx } from "./auth";
import { checkCompat, normalizeRules, pairStatus } from "./compat.pure";

export * from "./compat.pure";

const RUNNABLE = { notIn: ["retired", "scrapped"] };

/**
 * Presses a user may compare against. Internal users see every press in the organisation, so a
 * site-scoped user can still answer "which other site could run this mold?". Suppliers see only their own.
 */
export function pressScope(ctx: Ctx): Prisma.AssetWhereInput {
  const kind = { assetType: { kind: "press" }, status: RUNNABLE };
  return ctx.isSupplier ? { AND: [assetScope(ctx), kind] } : { orgId: ctx.org.id, deletedAt: null, ...kind };
}

export function moldScope(ctx: Ctx): Prisma.AssetWhereInput {
  return { AND: [assetScope(ctx), { assetType: { kind: "mold" }, parentId: null }] };
}

const withSite = { site: { include: { partner: true } } } as const;

/** Every press checked against one mold, approved pairs first, then compatible, then incompatible. */
export async function pressesForMold(ctx: Ctx, moldId: string, siteId?: string) {
  const rules = normalizeRules(ctx.org.compatRules);
  const [presses, pairs] = await Promise.all([
    db.asset.findMany({ where: { AND: [pressScope(ctx), siteId ? { siteId } : {}] }, include: withSite, orderBy: { number: "asc" } }),
    db.moldPress.findMany({ where: { moldId, status: "approved" } }),
  ]);
  const mold = await db.asset.findUniqueOrThrow({ where: { id: moldId } });
  return rank(presses.map((p) => {
    const verdict = checkCompat(mold, p, rules);
    const pair = pairs.find((x) => x.pressId === p.id) ?? null;
    return { other: p, verdict, pair, status: pairStatus(verdict, !!pair) };
  }));
}

/** Every mold in scope checked against one press. */
export async function moldsForPress(ctx: Ctx, pressId: string) {
  const rules = normalizeRules(ctx.org.compatRules);
  const press = await db.asset.findUniqueOrThrow({ where: { id: pressId } });
  const [molds, pairs] = await Promise.all([
    db.asset.findMany({ where: { AND: [moldScope(ctx), { status: RUNNABLE }] }, include: withSite, orderBy: { number: "asc" } }),
    db.moldPress.findMany({ where: { pressId, status: "approved" } }),
  ]);
  return rank(molds.map((m) => {
    const verdict = checkCompat(m, press, rules);
    const pair = pairs.find((x) => x.moldId === m.id) ?? null;
    return { other: m, verdict, pair, status: pairStatus(verdict, !!pair) };
  }));
}

function rank<T extends { status: string; other: { number: string } }>(rows: T[]) {
  const order = { approved: 0, compatible: 1, incompatible: 2 } as Record<string, number>;
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.other.number.localeCompare(b.other.number));
}
