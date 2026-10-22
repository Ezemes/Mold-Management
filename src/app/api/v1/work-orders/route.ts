import { db } from "@/lib/db";
import { apiRoute, dateParam, keyAssetScope, page, pageParams } from "@/lib/api";
import { workOrderInclude, workOrderOut } from "@/lib/api-out";

/** GET /api/v1/work-orders?status=completed&type=preventive&asset=M-0001&updated_since=… */
export const GET = apiRoute("work_orders:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const p = (k: string) => url.searchParams.get(k);
  const since = dateParam(url, "updated_since");
  const rows = await db.workOrder.findMany({
    where: { AND: [{ orgId: ctx.org.id, asset: keyAssetScope(ctx) }, p("status") ? { status: p("status")! } : {}, p("type") ? { type: p("type")! } : {}, p("asset") ? { asset: { number: { equals: p("asset")!, mode: "insensitive" } } } : {}, since ? { updatedAt: { gte: since } } : {}] },
    include: workOrderInclude,
    orderBy: { id: "asc" },
    ...pg,
  });
  return page(rows, limit, workOrderOut);
});
