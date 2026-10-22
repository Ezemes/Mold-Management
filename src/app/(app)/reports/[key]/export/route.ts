import { requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { buildReport, REPORTS, type ReportKey } from "@/lib/reports";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(key in REPORTS)) return new Response("Not found", { status: 404 });
  const ctx = await requireOrg(["reports", "view"]);
  const r = await buildReport(ctx, key as ReportKey);
  const csv = toCsv(r.columns, r.footer ? [...r.rows, r.footer] : r.rows);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
