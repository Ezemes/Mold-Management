import { requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { reorderList } from "@/lib/inventory-queries";

/** Purchase request lines for import into an ERP (spec §4.8: purchasing itself stays out of scope). */
export async function GET() {
  const ctx = await requireOrg(["inventory", "view"]);
  const rows = await reorderList(ctx);
  const csv = toCsv(
    ["part_number", "description", "manufacturer", "manufacturer_part_number", "deliver_to_site", "site_code", "quantity", "unit", "unit_cost", "currency", "line_value", "on_hand", "reorder_point"],
    rows.map((r) => [r.part.number, r.part.name, r.part.manufacturer, r.part.mfrPartNumber, r.site.name, r.site.code, r.order, r.part.unit, Number(r.part.unitCost), ctx.org.currency, r.order * Number(r.part.unitCost), r.quantity, r.reorderPoint]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="purchase-request-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
