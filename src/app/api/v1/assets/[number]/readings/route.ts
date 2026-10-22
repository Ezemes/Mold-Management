import { db } from "@/lib/db";
import { ApiError, apiRoute, dateParam, iso, keyAssetScope, page, pageParams } from "@/lib/api";

/** GET /api/v1/assets/{number}/readings?since=…  (newest first) */
export const GET = apiRoute<{ number: string }>("readings:read", async (req, ctx, { number }) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const since = dateParam(url, "since");
  const a = await db.asset.findFirst({ where: { AND: [keyAssetScope(ctx), { number: { equals: decodeURIComponent(number), mode: "insensitive" } }] }, include: { meters: true } });
  if (!a) throw new ApiError(404, "not_found", "Asset not found.");
  const meter = a.meters.find((m) => m.kind === "shots");
  if (!meter) return { data: [], next_cursor: null };
  const rows = await db.meterReading.findMany({ where: { meterId: meter.id, ...(since ? { readAt: { gte: since } } : {}) }, orderBy: [{ readAt: "desc" }, { id: "desc" }], ...pg });
  return page(rows, limit, (r) => ({ id: r.id, read_at: iso(r.readAt), value: r.rawValue, lifetime_shots: r.lifetime, delta: r.delta, source: r.source, is_reset: r.isReset, reset_reason: r.resetReason || null, note: r.note || null }));
});
