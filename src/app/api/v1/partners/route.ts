import { db } from "@/lib/db";
import { apiRoute } from "@/lib/api";
import { partnerOut } from "@/lib/api-out";

export const GET = apiRoute("sites:read", async (_req, ctx) => {
  const rows = await db.partner.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } });
  return { data: rows.map(partnerOut) };
});
