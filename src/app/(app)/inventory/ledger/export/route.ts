import { requireOrg } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { ledger } from "@/lib/inventory-queries";

export async function GET(req: Request) {
  const ctx = await requireOrg(["inventory", "view"]);
  const u = new URL(req.url).searchParams;
  const { moves } = await ledger(ctx, { siteId: u.get("site") || undefined, kind: u.get("kind") || undefined, take: 50000 });
  const csv = toCsv(
    ["timestamp_utc", "part_number", "part_name", "site", "movement", "quantity", "balance_after", "unit_cost", "work_order", "reference", "note", "expires"],
    moves.map((m) => [m.createdAt.toISOString(), m.part.number, m.part.name, m.siteName, m.kind, m.quantity, m.balanceAfter, Number(m.unitCost), m.wo?.number ?? "", m.reference, m.note, m.expiresAt?.toISOString().slice(0, 10) ?? ""]),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="stock-ledger.csv"' } });
}
