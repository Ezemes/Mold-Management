import { ApiError, apiRoute, jsonBody } from "@/lib/api";
import { ingestProduction } from "@/lib/ingest";

/**
 * POST /api/v1/production  { "reports": [{ "asset": "M-0003", "period_start": "…", "period_end": "…", "parts": 64000, "part_number": "TN-0003-A", "reference": "MES-123" }] }
 * Each report is reconciled against the shot counter (parts ÷ cavities) once readings bracket its period.
 */
export const POST = apiRoute("production:write", async (req, ctx) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const items = Array.isArray(body?.reports) ? body.reports : body && typeof body === "object" && "asset" in body ? [body] : null;
  if (!items) throw new ApiError(400, "invalid", "Send { \"reports\": [ … ] } or a single report object.");
  if (items.length > 1000) throw new ApiError(413, "too_many", "At most 1,000 reports per request.");
  const results = await ingestProduction({ orgId: ctx.org.id, userId: null, label: `API key “${ctx.key.name}”` }, { siteIds: ctx.key.siteIds }, items, "api");
  return { accepted: results.filter((r) => r.status !== "error").length, failed: results.filter((r) => r.status === "error").length, results };
});
