import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { reorderList } from "@/lib/inventory-queries";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Badge, EmptyState, FlashFromParams, LinkButton, PageHeader, Stat, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { INVENTORY_TABS } from "@/lib/tabs";

export const metadata = { title: "Reorder list" };

const STATUS = { out: ["red", "Out"], below_min: ["red", "Below min"], reorder: ["amber", "Reorder"], ok: ["green", "OK"] } as const;

export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["inventory", "view"]);
  const rows = await reorderList(ctx);
  const total = rows.reduce((s, r) => s + r.order * Number(r.part.unitCost), 0);
  return (
    <>
      <PageHeader title="Spare parts" subtitle="Parts at or below their reorder point, with the quantity to bring each site back to max. Export the list as a purchase request for your ERP." actions={rows.length > 0 && <LinkButton href="/inventory/reorder/export">Export purchase request (CSV)</LinkButton>} />
      <SubTabs tabs={INVENTORY_TABS} active="/inventory/reorder" />
      <FlashFromParams params={sp} />
      {rows.length === 0 ? <EmptyState title="Nothing to reorder" body="Every part with a reorder point is above it." /> : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2"><Stat label="Lines" value={rows.length} /><Stat label="Estimated value" value={fmtMoney(total, ctx.org)} /></div>
          <Table head={["Part", "Site", "On hand", "Reorder at", "Max", "Order", "Est. value", "Status"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/inventory/parts/${r.partId}`} className="font-medium hover:text-brand-700">{r.part.number}</Link><p className="text-xs text-ink-500">{r.part.name}{r.part.mfrPartNumber && ` · ${r.part.manufacturer} ${r.part.mfrPartNumber}`}</p></Td>
                <Td className="text-xs">{r.site.name}</Td>
                <Td>{fmtNum(r.quantity, ctx.org, 2)}</Td>
                <Td className="text-xs">{fmtNum(r.reorderPoint, ctx.org, 2)}</Td>
                <Td className="text-xs">{fmtNum(r.maxQty, ctx.org, 2)}</Td>
                <Td className="font-medium">{fmtNum(r.order, ctx.org)} {r.part.unit}</Td>
                <Td className="text-xs">{fmtMoney(r.order * Number(r.part.unitCost), ctx.org)}</Td>
                <Td><Badge color={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge></Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
