import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { downtimeScope, durationHours } from "@/lib/downtime";
import { dateToLocalInput } from "@/lib/format";

export async function GET() {
  const ctx = await requireOrg(["downtime", "view"]);
  const tz = ctx.org.timezone;
  const rows = await db.downtimeEvent.findMany({
    where: downtimeScope(ctx),
    include: { asset: { select: { number: true } }, press: { select: { number: true } }, code: true, workOrder: { select: { number: true } } },
    orderBy: [{ asset: { number: "asc" } }, { startedAt: "asc" }],
    take: 200_000,
  });
  const local = (d: Date | null) => (d ? dateToLocalInput(d, tz).replace("T", " ") : "");
  const csv = toCsv(
    ["number", "code", "started_at", "ended_at", "press", "work_order", "description", "event", "category", "reason", "duration_hours", "source"],
    rows.map((e) => [e.asset.number, e.code.code, local(e.startedAt), local(e.endedAt), e.press?.number ?? "", e.workOrder?.number ?? "", e.description, e.number, e.category, e.code.name, Math.round(durationHours(e) * 100) / 100, e.source]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="downtime-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
