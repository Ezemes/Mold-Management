import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { stdFieldsFor } from "@/lib/assets";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await requireOrg(["import_export", "view"]);
  if (kind === "readings") {
    const csv = toCsv(["number", "counter", "read_at", "note", "reset", "reset_reason"], [["M-0001", "125000", "22-10-2026 09:30", "Weekly reading", "no", ""]]);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="shot-readings-template.csv"' } });
  }
  if (kind === "downtime") {
    const csv = toCsv(["number", "code", "started_at", "ended_at", "press", "work_order", "description"], [
      ["M-0001", "COOL", "20-10-2026 08:15", "20-10-2026 11:40", "P-0001", "", "Water leak on cavity 3 circuit"],
      ["M-0001", "CHANGE", "21-10-2026 14:00", "21-10-2026 15:30", "", "", "Changeover to M-0002"],
    ]);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="downtime-template.csv"' } });
  }
  const key = new URL(req.url).searchParams.get("type") ?? "mold";
  const type = await db.assetType.findFirst({ where: { orgId: ctx.org.id, key }, include: { fields: { where: { archived: false, NOT: { type: "formula" } }, orderBy: { sortOrder: "asc" } } } });
  if (!type) return new Response("Unknown asset type", { status: 404 });
  const site = await db.site.findFirst({ where: { orgId: ctx.org.id, active: true }, orderBy: { createdAt: "asc" } });
  const header = ["number", "type", "name", "site", "location", "owner", "program", ...stdFieldsFor(type.kind).map((f) => f.var), ...type.fields.map((f) => `cf_${f.key}`)];
  const example: Record<string, string> = { number: `${type.numberPrefix}0001`, type: type.key, name: "Example", site: site?.code || site?.name || "", design_cavities: "4", design_cycle_time_s: "28", warranty_shots: "5,00,000", end_of_life_shots: "10,00,000", build_date: "15-01-2024" };
  const csv = toCsv(header, [header.map((h) => example[h] ?? "")]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type.key}-import-template.csv"` } });
}
