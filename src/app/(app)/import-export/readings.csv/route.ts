import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

export async function GET() {
  const ctx = await requireOrg(["readings", "view"]);
  const rows = await db.meterReading.findMany({
    where: { meter: { asset: assetScope(ctx) } },
    include: { meter: { include: { asset: { select: { number: true } } } }, enteredBy: { select: { email: true } } },
    orderBy: [{ meter: { asset: { number: "asc" } } }, { readAt: "asc" }],
    take: 200_000,
  });
  const csv = toCsv(
    ["number", "read_at_utc", "counter", "delta", "lifetime", "source", "reset", "reset_reason", "note", "entered_by"],
    rows.map((r) => [r.meter.asset.number, r.readAt.toISOString(), r.rawValue, r.delta, r.lifetime, r.source, r.isReset ? "yes" : "no", r.resetReason, r.note, r.enteredBy?.email ?? ""]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="shot-readings-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
