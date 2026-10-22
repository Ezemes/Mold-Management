import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiRoute, dateParam, keyAssetScope, page, pageParams } from "@/lib/api";
import { assetInclude, assetOut } from "@/lib/api-out";

/** GET /api/v1/assets?type=mold&site=PUN1&status=active&updated_since=…&limit=&cursor= */
export const GET = apiRoute("assets:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const type = url.searchParams.get("type");
  const site = url.searchParams.get("site");
  const status = url.searchParams.get("status");
  const since = dateParam(url, "updated_since");
  const where: Prisma.AssetWhereInput = {
    AND: [keyAssetScope(ctx), type ? { assetType: { OR: [{ kind: type }, { key: type }] } } : {}, site ? { site: { code: site } } : {}, status ? { status } : {}, since ? { updatedAt: { gte: since } } : {}],
  };
  const rows = await db.asset.findMany({ where, include: assetInclude, orderBy: { id: "asc" }, ...pg });
  return page(rows, limit, assetOut);
});
