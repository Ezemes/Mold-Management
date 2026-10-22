import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg, siteScope } from "@/lib/auth";
import { stockStatus } from "@/lib/inventory";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Badge, cx, FlashFromParams, PageHeader, Stat, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { INVENTORY_TABS } from "@/lib/tabs";

export const metadata = { title: "Stock by site" };

const STATUS = { out: ["red", "Out"], below_min: ["red", "Below min"], reorder: ["amber", "Reorder"], ok: ["green", "OK"] } as const;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ site?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["inventory", "view"]);
  const sites = await db.site.findMany({ where: { AND: [siteScope(ctx), { stock: { some: {} } }] }, orderBy: { name: "asc" } });
  const site = sites.find((s) => s.id === sp.site) ?? sites[0];
  const rows = site ? await db.stock.findMany({ where: { siteId: site.id, part: { orgId: ctx.org.id } }, include: { part: true }, orderBy: { part: { number: "asc" } } }) : [];
  const value = rows.reduce((s, r) => s + r.quantity * Number(r.part.unitCost), 0);
  return (
    <>
      <PageHeader title="Spare parts" subtitle="On-hand stock and value per site, at the latest receipt cost." />
      <SubTabs tabs={INVENTORY_TABS} active="/inventory/stock" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {sites.map((s) => <Link key={s.id} href={`/inventory/stock?site=${s.id}`} className={cx("rounded-md px-3 py-1.5 text-sm", s.id === site?.id ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{s.name}</Link>)}
      </div>
      {site && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Parts stocked" value={rows.length} />
          <Stat label="Stock value" value={fmtMoney(value, ctx.org)} />
          <Stat label="Need reordering" value={rows.filter((r) => stockStatus(r) !== "ok").length} />
        </div>
      )}
      <Table head={["Part", "Bin", "On hand", "Reorder at", "Value", "Status"]} empty="No stock at any site in your scope yet.">
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/inventory/parts/${r.partId}`} className="font-medium hover:text-brand-700">{r.part.number}</Link><p className="text-xs text-ink-500">{r.part.name}</p></Td>
            <Td className="text-xs">{r.bin || "—"}</Td>
            <Td>{fmtNum(r.quantity, ctx.org, 2)} <span className="text-xs text-ink-500">{r.part.unit}</span></Td>
            <Td className="text-xs">{fmtNum(r.reorderPoint, ctx.org, 2)}</Td>
            <Td className="text-xs">{fmtMoney(r.quantity * Number(r.part.unitCost), ctx.org)}</Td>
            <Td><Badge color={STATUS[stockStatus(r)][0]}>{STATUS[stockStatus(r)][1]}</Badge></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
