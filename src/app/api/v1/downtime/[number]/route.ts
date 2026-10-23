import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, apiRoute, jsonBody, keyAssetScope } from "@/lib/api";
import { downtimeInclude, downtimeOut, emitDowntime, otherEvents, validateDowntime } from "@/lib/downtime";

async function find(orgId: string, number: string, scope: ReturnType<typeof keyAssetScope>) {
  const e = await db.downtimeEvent.findFirst({ where: { orgId, number: decodeURIComponent(number).toUpperCase(), asset: scope }, include: downtimeInclude });
  if (!e) throw new ApiError(404, "not_found", "Downtime event not found.");
  return e;
}

export const GET = apiRoute<{ number: string }>("downtime:read", async (_req, ctx, { number }) => ({ data: downtimeOut(await find(ctx.org.id, number, keyAssetScope(ctx))) }));

/** PATCH /api/v1/downtime/{number}  { "ended_at": "…" }  ends an open event (the mold runs again). */
export const PATCH = apiRoute<{ number: string }>("downtime:write", async (req, ctx, { number }) => {
  const e = await find(ctx.org.id, number, keyAssetScope(ctx));
  const b = (req.headers.get("content-type")?.includes("json") ? await jsonBody(req) : {}) as Record<string, unknown>;
  if (e.endedAt) throw new ApiError(409, "conflict", `${e.number} has already ended.`);
  const endedAt = b?.ended_at ? new Date(String(b.ended_at)) : new Date();
  if (isNaN(endedAt.getTime())) throw new ApiError(400, "invalid", "“ended_at” must be an ISO 8601 date-time.");
  const problem = validateDowntime({ startedAt: e.startedAt, endedAt }, await otherEvents(db, e.assetId, e.id));
  if (problem) throw new ApiError(409, "conflict", problem);
  await db.$transaction(async (tx) => {
    await tx.downtimeEvent.update({ where: { id: e.id }, data: { endedAt } });
    await audit({ orgId: ctx.org.id, userId: null }, { action: "downtime_ended", entityType: "downtime", entityId: e.id, entityLabel: `${e.number} ${e.asset.number}`, after: { endedAt }, reason: `API key “${ctx.key.name}”` }, tx);
  });
  await emitDowntime(e.id, "downtime.ended");
  return { data: downtimeOut({ ...e, endedAt }) };
});
