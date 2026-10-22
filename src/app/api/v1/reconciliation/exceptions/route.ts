import { db } from "@/lib/db";
import { apiRoute, iso, keyAssetScope, page, pageParams } from "@/lib/api";

/** GET /api/v1/reconciliation/exceptions?status=open */
export const GET = apiRoute("reconciliation:read", async (req, ctx) => {
  const url = new URL(req.url);
  const { limit, ...pg } = pageParams(url);
  const status = url.searchParams.get("status");
  const rows = await db.reconciliationException.findMany({ where: { orgId: ctx.org.id, asset: keyAssetScope(ctx), ...(status ? { status } : {}) }, include: { asset: { select: { number: true } }, report: true }, orderBy: { id: "asc" }, ...pg });
  return page(rows, limit, (x) => ({
    id: x.id, asset: x.asset.number, status: x.status, period_start: iso(x.report.periodStart), period_end: iso(x.report.periodEnd), part_number: x.report.partNumber || null, parts: x.report.parts,
    expected_shots: x.expectedShots, recorded_shots: x.recordedShots, gap: x.gap, gap_pct: x.gapPct, resolution: x.resolution || null, resolved_at: iso(x.resolvedAt), created_at: iso(x.createdAt),
  }));
});
