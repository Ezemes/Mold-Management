import { db } from "@/lib/db";
import { apiRoute, iso, page, pageParams } from "@/lib/api";

/**
 * GET /api/v1/events?type=work_order.closed&cursor=<last id>  — the same events webhooks send, oldest first,
 * for integrations that poll instead of receiving webhooks. Events are kept for 90 days.
 * Restricted keys see no events: payloads can name assets at any site.
 */
export const GET = apiRoute("events:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  if (ctx.key.siteIds.length) return { data: [], next_cursor: null };
  const type = url.searchParams.get("type");
  const rows = await db.outboundEvent.findMany({ where: { orgId: ctx.org.id, type: type ?? { not: "ping" } }, orderBy: { id: "asc" }, ...pg });
  return page(rows, limit, (e) => ({ id: e.id, type: e.type, created_at: iso(e.createdAt), data: e.data }));
});
