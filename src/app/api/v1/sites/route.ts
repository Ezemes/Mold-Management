import { db } from "@/lib/db";
import { apiRoute } from "@/lib/api";
import { siteOut } from "@/lib/api-out";

export const GET = apiRoute("sites:read", async (_req, ctx) => {
  const rows = await db.site.findMany({ where: { orgId: ctx.org.id, ...(ctx.key.siteIds.length ? { id: { in: ctx.key.siteIds } } : {}) }, include: { partner: true }, orderBy: { name: "asc" } });
  return { data: rows.map(siteOut) };
});
