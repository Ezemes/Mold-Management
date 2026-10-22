import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg, siteScope } from "@/lib/auth";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Badge, Card, cx, EmptyState, Field, FlashFromParams, Input, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { INVENTORY_TABS } from "@/lib/tabs";
import { stockStatus } from "@/lib/inventory";
import { savePartAction } from "./actions";

export const metadata = { title: "Spare parts" };

export default async function PartsPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["inventory", "view"]);
  const q = sp.q?.trim() ?? "";
  const parts = await db.part.findMany({
    where: { orgId: ctx.org.id, ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { mfrPartNumber: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { stock: { where: { site: siteScope(ctx) } }, _count: { select: { assets: true } } },
    orderBy: [{ active: "desc" }, { number: "asc" }],
    take: 500,
  });
  const showNew = sp.new === "1" && ctx.can("inventory", "create");
  return (
    <>
      <PageHeader title="Spare parts" subtitle="Parts catalogue with stock per site. Issue parts to work orders from the work order page." actions={ctx.can("inventory", "create") && <LinkButton href="/inventory?new=1">New part</LinkButton>} />
      <SubTabs tabs={INVENTORY_TABS} active="/inventory" />
      <FlashFromParams params={sp} />
      {showNew && (
        <Card title="New part" className="mb-6">
          <form action={savePartAction} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Part number" name="number"><Input name="number" required placeholder="EJ-6x150" /></Field>
            <Field label="Name" name="name" className="sm:col-span-2"><Input name="name" required placeholder="Ejector pin 6 × 150" /></Field>
            <Field label="Category" name="category"><Input name="category" placeholder="Ejectors" /></Field>
            <Field label="Manufacturer" name="manufacturer"><Input name="manufacturer" /></Field>
            <Field label="Manufacturer part no." name="mfrPartNumber"><Input name="mfrPartNumber" /></Field>
            <Field label="Unit" name="unit"><Input name="unit" defaultValue="pcs" /></Field>
            <Field label={`Unit cost (${ctx.org.currency})`} name="unitCost"><Input name="unitCost" inputMode="decimal" /></Field>
            <Field label="Min qty" name="minQty"><Input name="minQty" inputMode="decimal" /></Field>
            <Field label="Reorder point" name="reorderPoint"><Input name="reorderPoint" inputMode="decimal" /></Field>
            <Field label="Max qty" name="maxQty"><Input name="maxQty" inputMode="decimal" /></Field>
            <Field label="Shelf life (days)" name="shelfLifeDays"><Input name="shelfLifeDays" inputMode="numeric" /></Field>
            <Field label="Used on assets" name="assets" hint="Asset numbers, comma separated." className="sm:col-span-3 lg:col-span-4"><Input name="assets" placeholder="M-0001, M-0002" /></Field>
            <div className="flex gap-2 sm:col-span-3 lg:col-span-4"><SubmitButton>Create part</SubmitButton><LinkButton href="/inventory" variant="ghost">Cancel</LinkButton></div>
          </form>
        </Card>
      )}
      <form className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search number, name, manufacturer no. or category" aria-label="Search parts" className="max-w-md" />
        <button className="rounded-md border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50">Search</button>
      </form>
      {parts.length === 0 ? <EmptyState title={q ? "No parts match" : "No parts yet"} /> : (
        <Table head={["Part", "Category", "Unit cost", "In stock", "Sites", "Used on", ""]}>
          {parts.map((p) => {
            const total = p.stock.reduce((s, x) => s + x.quantity, 0);
            const low = p.stock.filter((s) => stockStatus(s) !== "ok").length;
            return (
              <tr key={p.id} className={cx("hover:bg-gray-50", !p.active && "opacity-50")}>
                <Td><Link href={`/inventory/parts/${p.id}`} className="font-medium hover:text-brand-700">{p.number}</Link><p className="text-xs text-ink-500">{p.name}{p.mfrPartNumber && ` · ${p.manufacturer} ${p.mfrPartNumber}`}</p></Td>
                <Td className="text-xs">{p.category || "—"}</Td>
                <Td className="text-xs">{fmtMoney(Number(p.unitCost), ctx.org)}</Td>
                <Td>{fmtNum(total, ctx.org, 2)} <span className="text-xs text-ink-500">{p.unit}</span></Td>
                <Td className="text-xs">{p.stock.length}</Td>
                <Td className="text-xs">{p._count.assets ? `${p._count.assets} asset(s)` : "—"}</Td>
                <Td>{low > 0 && <Badge color="amber">{low} site(s) low</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
