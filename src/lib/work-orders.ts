import "server-only";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "./auth";
import { assetScope } from "./auth";

export * from "./maintenance.pure";

export async function nextWorkOrderNumber(tx: Prisma.TransactionClient, orgId: string) {
  const rows = await tx.workOrder.findMany({ where: { orgId }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number.replace(/^WO-/, ""), 10) || 0), 0);
  return `WO-${String(max + 1).padStart(5, "0")}`;
}

/** Work orders a user may see: those on assets in scope; suppliers also see work assigned to their company. */
export function workOrderScope(ctx: Ctx): Prisma.WorkOrderWhereInput {
  if (ctx.scope.type === "partner") return { orgId: ctx.org.id, OR: [{ asset: assetScope(ctx) }, { assignedPartnerId: ctx.scope.partnerId ?? "__none__" }] };
  return { orgId: ctx.org.id, asset: assetScope(ctx) };
}
