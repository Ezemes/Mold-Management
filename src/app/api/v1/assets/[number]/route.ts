import { db } from "@/lib/db";
import { ApiError, apiRoute, keyAssetScope } from "@/lib/api";
import { assetInclude, assetOut } from "@/lib/api-out";

export const GET = apiRoute<{ number: string }>("assets:read", async (_req, ctx, { number }) => {
  const a = await db.asset.findFirst({ where: { AND: [keyAssetScope(ctx), { number: { equals: decodeURIComponent(number), mode: "insensitive" } }] }, include: assetInclude });
  if (!a) throw new ApiError(404, "not_found", "Asset not found.");
  return { data: assetOut(a, ctx.org) };
});
