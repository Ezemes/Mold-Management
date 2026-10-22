import "server-only";
import { db } from "./db";
import { siteScope, type Ctx } from "./auth";
import { reorderQty, stockStatus } from "./inventory.pure";

/** Stock rows at or below their reorder level at sites in scope, with suggested order quantities. */
export async function reorderList(ctx: Ctx) {
  const rows = await db.stock.findMany({ where: { site: siteScope(ctx), part: { orgId: ctx.org.id, active: true } }, include: { part: true, site: true }, orderBy: [{ site: { name: "asc" } }, { part: { number: "asc" } }] });
  return rows.map((s) => ({ ...s, status: stockStatus(s), order: reorderQty(s) })).filter((s) => s.order > 0);
}

export async function ledger(ctx: Ctx, f: { siteId?: string; kind?: string; take?: number }) {
  const sites = await db.site.findMany({ where: siteScope(ctx), select: { id: true, name: true } });
  const ids = sites.map((s) => s.id).filter((id) => !f.siteId || id === f.siteId);
  const moves = await db.stockMove.findMany({ where: { orgId: ctx.org.id, siteId: { in: ids }, ...(f.kind ? { kind: f.kind } : {}) }, include: { part: true }, orderBy: { createdAt: "desc" }, take: f.take ?? 500 });
  const wos = await db.workOrder.findMany({ where: { id: { in: moves.map((m) => m.workOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  return { sites, moves: moves.map((m) => ({ ...m, siteName: sites.find((s) => s.id === m.siteId)?.name ?? "", wo: wos.find((w) => w.id === m.workOrderId) ?? null })) };
}
