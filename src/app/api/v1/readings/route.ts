import { ApiError, apiRoute, jsonBody } from "@/lib/api";
import { ingestReadings } from "@/lib/ingest";

/**
 * POST /api/v1/readings  { "readings": [{ "asset": "M-0001", "value": 412500, "read_at": "…", "is_reset": false, "reset_reason": "", "note": "" }] }
 * (or a single reading object). Up to 1,000 per request; each is accepted or rejected on its own.
 */
export const POST = apiRoute("readings:write", async (req, ctx) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const items = Array.isArray(body?.readings) ? body.readings : body && typeof body === "object" && "asset" in body ? [body] : null;
  if (!items) throw new ApiError(400, "invalid", "Send { \"readings\": [ … ] } or a single reading object.");
  if (items.length > 1000) throw new ApiError(413, "too_many", "At most 1,000 readings per request.");
  const results = await ingestReadings({ orgId: ctx.org.id, userId: null, label: `API key “${ctx.key.name}”` }, { siteIds: ctx.key.siteIds }, items);
  return { created: results.filter((r) => r.status === "created").length, duplicates: results.filter((r) => r.status === "duplicate").length, failed: results.filter((r) => r.status === "error").length, results };
});
