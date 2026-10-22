import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  const ctx = await requireOrg(["audit", "view"]);
  const type = new URL(req.url).searchParams.get("type");
  const rows = await db.auditEvent.findMany({ where: { orgId: ctx.org.id, ...(type ? { entityType: type } : {}) }, orderBy: { createdAt: "desc" }, take: 50000, include: { user: true } });
  const csv = toCsv(
    ["timestamp_utc", "user", "action", "entity_type", "entity_id", "entity", "reason", "before", "after"],
    rows.map((r) => [r.createdAt.toISOString(), r.user?.email ?? "system", r.action, r.entityType, r.entityId, r.entityLabel, r.reason, r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : ""]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-log.csv"' } });
}
