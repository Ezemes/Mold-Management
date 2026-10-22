import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { ledger } from "@/lib/inventory-queries";
import { MOVE_KINDS } from "@/lib/inventory";
import { label } from "@/lib/labels";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { FlashFromParams, LinkButton, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { INVENTORY_TABS } from "@/lib/tabs";

export const metadata = { title: "Stock ledger" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ site?: string; kind?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["inventory", "view"]);
  const kind = sp.kind && sp.kind in MOVE_KINDS ? sp.kind : undefined;
  const { sites, moves } = await ledger(ctx, { siteId: sp.site || undefined, kind });
  const qs = new URLSearchParams({ ...(sp.site ? { site: sp.site } : {}), ...(kind ? { kind } : {}) }).toString();
  return (
    <>
      <PageHeader title="Spare parts" subtitle="Every receipt, issue, return, move and adjustment, newest first." actions={<LinkButton href={`/inventory/ledger/export${qs ? `?${qs}` : ""}`} variant="secondary">Export CSV</LinkButton>} />
      <SubTabs tabs={INVENTORY_TABS} active="/inventory/ledger" />
      <FlashFromParams params={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="site" placeholder="All sites" options={sites.map((s) => [s.id, s.name] as [string, string])} defaultValue={sp.site ?? ""} aria-label="Site" className="w-48" />
        <Select name="kind" placeholder="All movements" options={MOVE_KINDS} defaultValue={kind ?? ""} aria-label="Movement" className="w-48" />
        <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">Filter</button>
      </form>
      <Table head={["When", "Part", "Site", "Movement", "Qty", "Balance", "Reference"]} empty="No movements.">
        {moves.map((m) => (
          <tr key={m.id}>
            <Td className="text-xs">{fmtDateTime(m.createdAt, ctx.org.timezone)}</Td>
            <Td><Link href={`/inventory/parts/${m.partId}`} className="hover:text-brand-700">{m.part.number}</Link></Td>
            <Td className="text-xs">{m.siteName}</Td>
            <Td className="text-xs">{label(MOVE_KINDS, m.kind)}</Td>
            <Td className={m.quantity < 0 ? "text-red-700" : "text-emerald-700"}>{m.quantity > 0 ? "+" : ""}{fmtNum(m.quantity, ctx.org, 2)}</Td>
            <Td className="text-xs">{fmtNum(m.balanceAfter, ctx.org, 2)}</Td>
            <Td className="text-xs">{m.wo ? <Link href={`/maintenance/work-orders/${m.wo.id}`} className="text-brand-700 hover:underline">{m.wo.number}</Link> : m.reference}{m.note && <span className="block text-ink-500">{m.note}</span>}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
