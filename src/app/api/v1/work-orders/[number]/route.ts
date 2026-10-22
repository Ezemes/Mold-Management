import { db } from "@/lib/db";
import { ApiError, apiRoute, keyAssetScope } from "@/lib/api";
import { workOrderInclude, workOrderOut } from "@/lib/api-out";

export const GET = apiRoute<{ number: string }>("work_orders:read", async (_req, ctx, { number }) => {
  const w = await db.workOrder.findFirst({ where: { orgId: ctx.org.id, number: decodeURIComponent(number).toUpperCase(), asset: keyAssetScope(ctx) }, include: workOrderInclude });
  if (!w) throw new ApiError(404, "not_found", "Work order not found.");
  return { data: workOrderOut(w) };
});
