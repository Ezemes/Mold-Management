import { db } from "@/lib/db";
import { apiRoute, dateParam, keyTransferScope, page, pageParams } from "@/lib/api";
import { transferInclude, transferOut } from "@/lib/api-out";

/** GET /api/v1/transfers?status=in_transit&updated_since=… */
export const GET = apiRoute("transfers:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const status = url.searchParams.get("status");
  const since = dateParam(url, "updated_since");
  const rows = await db.transfer.findMany({ where: { AND: [keyTransferScope(ctx), status ? { status } : {}, since ? { updatedAt: { gte: since } } : {}] }, include: transferInclude, orderBy: { id: "asc" }, ...pg });
  return page(rows, limit, transferOut);
});
