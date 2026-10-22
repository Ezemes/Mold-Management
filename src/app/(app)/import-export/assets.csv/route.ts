import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { assetFilter } from "@/lib/asset-filter";
import { STD_FIELDS } from "@/lib/assets";
import { toCsv } from "@/lib/csv";

/** Round-trippable export: same columns as the import template, plus read-only live columns. */
export async function GET(req: Request) {
  const ctx = await requireOrg(["import_export", "view"]);
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const assets = await db.asset.findMany({
    where: { AND: [assetScope(ctx), assetFilter(sp)] },
    include: { assetType: { include: { fields: { where: { archived: false, NOT: { type: "formula" } } } } }, site: true, ownerPartner: true, custodianPartner: true, meters: true, parent: true },
    orderBy: { number: "asc" },
    take: 50_000,
  });
  const customKeys = [...new Set(assets.flatMap((a) => a.assetType.fields.map((f) => f.key)))];
  const header = ["number", "type", "name", "site", "location", "owner", "program", ...STD_FIELDS.map((f) => f.var), ...customKeys.map((k) => `cf_${k}`), "status", "custodian", "parent", "lifetime_shots", "last_reading_at"];
  const fmt = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const rows = assets.map((a) => {
    const cv = a.customValues as Record<string, unknown>;
    const shots = a.meters.find((m) => m.kind === "shots");
    return [
      a.number, a.assetType.key, a.name, a.site.code || a.site.name, a.locationDetail, a.ownerPartner?.name ?? "", a.program,
      ...STD_FIELDS.map((f) => (f.kinds.includes(a.assetType.kind as never) ? fmt(a[f.key]) : "")),
      ...customKeys.map((k) => fmt(cv[k])),
      a.status, a.custodianPartner?.name ?? ctx.org.name, a.parent?.number ?? "", shots ? String(shots.lifetimeTotal) : "", shots?.lastReadingAt?.toISOString() ?? "",
    ];
  });
  return new Response(toCsv(header, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
