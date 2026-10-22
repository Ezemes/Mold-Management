import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { assetScope, requireOrg, siteScope } from "@/lib/auth";
import { MOVE_KINDS, stockStatus } from "@/lib/inventory";
import { label } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { adjustStockAction, receiveStockAction, savePartAction, setLevelsAction, transferStockAction } from "../../actions";

export const metadata = { title: "Spare part" };

const STATUS = { out: ["red", "Out of stock"], below_min: ["red", "Below min"], reorder: ["amber", "Reorder"], ok: ["green", "OK"] } as const;

export default async function PartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["inventory", "view"]);
  const p = await db.part.findFirst({ where: { id, orgId: ctx.org.id }, include: { assets: { where: { asset: assetScope(ctx) }, include: { asset: true } } } });
  if (!p) notFound();
  const [stock, moves, sites, allSites] = await Promise.all([
    db.stock.findMany({ where: { partId: p.id, site: siteScope(ctx) }, include: { site: true }, orderBy: { site: { name: "asc" } } }),
    db.stockMove.findMany({ where: { partId: p.id, siteId: { in: (await db.site.findMany({ where: siteScope(ctx), select: { id: true } })).map((s) => s.id) } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.site.findMany({ where: { AND: [siteScope(ctx), { active: true }] }, orderBy: { name: "asc" } }),
    db.site.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: "asc" } }),
  ]);
  const siteName = (sid: string) => allSites.find((s) => s.id === sid)?.name ?? "—";
  const wos = await db.workOrder.findMany({ where: { id: { in: moves.map((m) => m.workOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const canEdit = ctx.can("inventory", "edit");
  // Sites that already stock this part come first, so the forms default to them.
  const siteOpts = [...sites].sort((a, b) => Number(stock.some((x) => x.siteId === b.id)) - Number(stock.some((x) => x.siteId === a.id))).map((s) => [s.id, s.name] as [string, string]);
  const n = (v: number) => fmtNum(v, ctx.org, 2);
  return (
    <>
      <PageHeader back={{ href: "/inventory", label: "Spare parts" }} title={`${p.number} ${p.name}`} subtitle={[p.category, p.manufacturer && `${p.manufacturer} ${p.mfrPartNumber}`, `${fmtMoney(Number(p.unitCost), ctx.org)} per ${p.unit}`, p.shelfLifeDays && `shelf life ${p.shelfLifeDays} days`].filter(Boolean).join(" · ")} />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Table head={["Site", "Bin", "On hand", "Min", "Reorder at", "Max", "Status"]} empty="No stock recorded yet. Receive stock to start.">
            {stock.map((s) => (
              <tr key={s.id}>
                <Td>{s.site.name}</Td>
                <Td className="text-xs">{s.bin || "—"}</Td>
                <Td className="font-medium">{n(s.quantity)} {p.unit}</Td>
                <Td className="text-xs">{n(s.minQty)}</Td>
                <Td className="text-xs">{n(s.reorderPoint)}</Td>
                <Td className="text-xs">{n(s.maxQty)}</Td>
                <Td><Badge color={STATUS[stockStatus(s)][0]}>{STATUS[stockStatus(s)][1]}</Badge></Td>
              </tr>
            ))}
          </Table>
          <Card title="Ledger (latest 50)">
            <Table head={["When", "Site", "Movement", "Qty", "Balance", "Reference"]} empty="No movements yet.">
              {moves.map((m) => {
                const wo = wos.find((w) => w.id === m.workOrderId);
                return (
                  <tr key={m.id}>
                    <Td className="text-xs">{fmtDateTime(m.createdAt, ctx.org.timezone)}</Td>
                    <Td className="text-xs">{siteName(m.siteId)}</Td>
                    <Td className="text-xs">{label(MOVE_KINDS, m.kind)}</Td>
                    <Td className={m.quantity < 0 ? "text-red-700" : "text-emerald-700"}>{m.quantity > 0 ? "+" : ""}{n(m.quantity)}</Td>
                    <Td className="text-xs">{n(m.balanceAfter)}</Td>
                    <Td className="text-xs">{wo ? <Link href={`/maintenance/work-orders/${wo.id}`} className="text-brand-700 hover:underline">{wo.number}</Link> : m.reference}{m.note && <p className="text-ink-500">{m.note}</p>}{m.expiresAt && <p className="text-ink-500">expires {fmtDate(m.expiresAt, ctx.org.timezone)}</p>}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          <Card title="Used on">
            {p.assets.length === 0 ? <p className="text-sm text-ink-500">Not linked to any asset.</p> : <p className="text-sm">{p.assets.map((x) => <Link key={x.assetId} href={`/assets/${x.assetId}`} className="mr-3 text-brand-700 hover:underline">{x.asset.number}</Link>)}</p>}
          </Card>
          {ctx.can("inventory", "edit") && (
            <Card title="Edit part">
              <form action={savePartAction} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="id" value={p.id} />
                <Field label="Part number" name="number"><Input name="number" defaultValue={p.number} required /></Field>
                <Field label="Name" name="name" className="sm:col-span-2"><Input name="name" defaultValue={p.name} required /></Field>
                <Field label="Category" name="category"><Input name="category" defaultValue={p.category} /></Field>
                <Field label="Manufacturer" name="manufacturer"><Input name="manufacturer" defaultValue={p.manufacturer} /></Field>
                <Field label="Manufacturer part no." name="mfrPartNumber"><Input name="mfrPartNumber" defaultValue={p.mfrPartNumber} /></Field>
                <Field label="Unit" name="unit"><Input name="unit" defaultValue={p.unit} /></Field>
                <Field label="Unit cost" name="unitCost"><Input name="unitCost" inputMode="decimal" defaultValue={Number(p.unitCost)} /></Field>
                <Field label="Shelf life (days)" name="shelfLifeDays"><Input name="shelfLifeDays" defaultValue={p.shelfLifeDays ?? ""} /></Field>
                <Field label="Default min" name="minQty"><Input name="minQty" defaultValue={p.minQty} /></Field>
                <Field label="Default reorder point" name="reorderPoint"><Input name="reorderPoint" defaultValue={p.reorderPoint} /></Field>
                <Field label="Default max" name="maxQty"><Input name="maxQty" defaultValue={p.maxQty} /></Field>
                <Field label="Used on assets" name="assets" className="sm:col-span-3"><Input name="assets" defaultValue={p.assets.map((x) => x.asset.number).join(", ")} /></Field>
                <div className="sm:col-span-3"><SubmitButton variant="secondary">Save part</SubmitButton></div>
              </form>
            </Card>
          )}
        </div>
        {canEdit && (
          <div className="space-y-6">
            <Card title="Receive stock">
              <form action={receiveStockAction} className="space-y-3">
                <input type="hidden" name="partId" value={p.id} />
                <Select name="siteId" options={siteOpts} aria-label="Receiving site" />
                <div className="grid grid-cols-2 gap-2">
                  <Input name="quantity" inputMode="decimal" placeholder="Quantity" aria-label="Quantity received" required />
                  <Input name="unitCost" inputMode="decimal" placeholder={`Cost ${Number(p.unitCost)}`} aria-label="Unit cost" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input name="reference" placeholder="PO / invoice no." aria-label="Reference" />
                  <Input name="bin" placeholder="Bin" aria-label="Bin" />
                </div>
                {p.shelfLifeDays && <Input name="expiresAt" placeholder="Expiry DD-MM-YYYY (blank = shelf life)" aria-label="Expiry date" />}
                <SubmitButton size="sm">Receive</SubmitButton>
              </form>
            </Card>
            <Card title="Count / adjust">
              <form action={adjustStockAction} className="space-y-3">
                <input type="hidden" name="partId" value={p.id} />
                <Select name="siteId" options={siteOpts} aria-label="Site counted" />
                <Input name="counted" inputMode="decimal" placeholder="Counted quantity" aria-label="Counted quantity" required />
                <Input name="reason" placeholder="Reason (cycle count, damaged…)" aria-label="Adjustment reason" />
                <SubmitButton size="sm" variant="secondary">Adjust</SubmitButton>
              </form>
            </Card>
            <Card title="Move between sites">
              <form action={transferStockAction} className="space-y-3">
                <input type="hidden" name="partId" value={p.id} />
                <Field label="From" name="fromSiteId"><Select name="fromSiteId" options={siteOpts} /></Field>
                <Field label="To" name="toSiteId"><Select name="toSiteId" options={allSites.map((s) => [s.id, s.name] as [string, string])} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Input name="quantity" inputMode="decimal" placeholder="Quantity" aria-label="Quantity to move" required />
                  <Input name="reference" placeholder="Reference" aria-label="Move reference" />
                </div>
                <SubmitButton size="sm" variant="secondary">Move stock</SubmitButton>
              </form>
            </Card>
            <Card title="Levels per site">
              <form action={setLevelsAction} className="space-y-3">
                <input type="hidden" name="partId" value={p.id} />
                <Select name="siteId" options={siteOpts} aria-label="Site" />
                <div className="grid grid-cols-3 gap-2">
                  <Input name="minQty" placeholder="Min" aria-label="Min quantity" />
                  <Input name="reorderPoint" placeholder="Reorder at" aria-label="Reorder point" />
                  <Input name="maxQty" placeholder="Max" aria-label="Max quantity" />
                </div>
                <Input name="bin" placeholder="Bin" aria-label="Bin location" />
                <SubmitButton size="sm" variant="secondary">Save levels</SubmitButton>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
