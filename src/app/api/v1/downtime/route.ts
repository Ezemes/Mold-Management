import { db } from "@/lib/db";
import { ApiError, apiRoute, dateParam, jsonBody, keyAssetScope, page, pageParams } from "@/lib/api";
import { createDowntime, DOWNTIME_CATEGORIES, downtimeInclude, downtimeOut, DowntimeError, emitDowntime, ensureCodes } from "@/lib/downtime";

/** GET /api/v1/downtime?asset=M-0001&category=failure&open=true&updated_since=… */
export const GET = apiRoute("downtime:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const p = (k: string) => url.searchParams.get(k);
  const since = dateParam(url, "updated_since");
  if (p("category") && !(p("category")! in DOWNTIME_CATEGORIES)) throw new ApiError(400, "invalid_parameter", `“category” must be one of ${Object.keys(DOWNTIME_CATEGORIES).join(", ")}.`);
  const rows = await db.downtimeEvent.findMany({
    where: {
      AND: [
        { orgId: ctx.org.id, asset: keyAssetScope(ctx) },
        p("asset") ? { asset: { number: { equals: p("asset")!, mode: "insensitive" } } } : {},
        p("category") ? { category: p("category")! } : {},
        p("open") === "true" ? { endedAt: null } : p("open") === "false" ? { NOT: { endedAt: null } } : {},
        since ? { updatedAt: { gte: since } } : {},
      ],
    },
    include: downtimeInclude,
    orderBy: { id: "asc" },
    ...pg,
  });
  return page(rows, limit, (r) => downtimeOut(r));
});

const date = (v: unknown, name: string, required: boolean) => {
  if (v == null || v === "") {
    if (required) throw new ApiError(400, "invalid", `“${name}” is required (ISO 8601).`);
    return null;
  }
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new ApiError(400, "invalid", `“${name}” must be an ISO 8601 date-time.`);
  return d;
};

/**
 * POST /api/v1/downtime  { "asset": "M-0001", "code": "COOL", "started_at": "…", "ended_at": null, "press": "P-0001", "work_order": "WO-00012", "description": "…" }
 * Leave ended_at out while the mold is still down, then PATCH /api/v1/downtime/{number} with ended_at.
 */
export const POST = apiRoute("downtime:write", async (req, ctx) => {
  const b = (await jsonBody(req)) as Record<string, unknown>;
  if (!b || typeof b !== "object") throw new ApiError(400, "invalid", "Send a JSON object.");
  const a = await db.asset.findFirst({ where: { AND: [keyAssetScope(ctx), { number: { equals: String(b.asset ?? ""), mode: "insensitive" } }] }, select: { id: true, number: true } });
  if (!a) throw new ApiError(404, "not_found", "Asset not found.");
  await ensureCodes(ctx.org.id);
  const code = await db.downtimeCode.findFirst({ where: { orgId: ctx.org.id, code: String(b.code ?? "").toUpperCase(), active: true } });
  if (!code) throw new ApiError(400, "invalid", "Unknown or inactive “code”. See Downtime → Reason codes.");
  const press = b.press ? await db.asset.findFirst({ where: { AND: [keyAssetScope(ctx), { assetType: { kind: "press" }, number: { equals: String(b.press), mode: "insensitive" } }] }, select: { id: true } }) : null;
  if (b.press && !press) throw new ApiError(400, "invalid", "Unknown “press”.");
  const wo = b.work_order ? await db.workOrder.findFirst({ where: { orgId: ctx.org.id, assetId: a.id, number: String(b.work_order).toUpperCase() }, select: { id: true } }) : null;
  if (b.work_order && !wo) throw new ApiError(400, "invalid", "Unknown “work_order” for this asset.");
  const startedAt = date(b.started_at, "started_at", true)!;
  const endedAt = date(b.ended_at, "ended_at", false);
  let id: string;
  try {
    id = (await db.$transaction((tx) => createDowntime(tx, { orgId: ctx.org.id, userId: null }, {
      assetId: a.id, assetNumber: a.number, codeId: code.id, category: code.category, startedAt, endedAt, description: String(b.description ?? "").slice(0, 2000), pressId: press?.id ?? null, workOrderId: wo?.id ?? null, source: "api",
    }, `API key “${ctx.key.name}”`))).id;
  } catch (e) {
    if (e instanceof DowntimeError) throw new ApiError(409, "conflict", e.message);
    throw e;
  }
  await emitDowntime(id, "downtime.started");
  if (endedAt) await emitDowntime(id, "downtime.ended");
  const e = await db.downtimeEvent.findUniqueOrThrow({ where: { id }, include: downtimeInclude });
  return Response.json({ data: downtimeOut(e) }, { status: 201 });
});
