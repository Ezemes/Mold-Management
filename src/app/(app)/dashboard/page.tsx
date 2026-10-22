import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { ASSET_STATUS } from "@/lib/assets";
import { liveStats, custodianName } from "@/lib/passport";
import { label } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, Stat } from "@/components/ui";
import { LifeBar } from "@/components/life-bar";
import { OPEN_WO, workOrderScope } from "@/lib/maintenance";
import { transferScope } from "@/lib/transfers";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const scope = assetScope(ctx);
  const assets = await db.asset.findMany({
    where: { AND: [scope, { parentId: null }] },
    include: { assetType: { include: { fields: true } }, cavities: { select: { status: true } }, meters: true, custodianPartner: true, site: true },
  });
  const rows = assets.map((a) => ({ a, l: liveStats(a, ctx.org.readingOverdueDays) }));
  const molds = rows.filter((r) => r.a.assetType.kind === "mold");
  const overdue = rows.filter((r) => r.l.readingOverdue);
  const nearEol = molds.filter((r) => (r.l.endOfLifePct ?? 0) >= 80).sort((x, y) => (y.l.endOfLifePct ?? 0) - (x.l.endOfLifePct ?? 0));
  const byStatus = Object.entries(ASSET_STATUS).map(([k, v]) => [v, rows.filter((r) => r.a.status === k).length] as const).filter(([, n]) => n);
  const byCustodian = [...rows.reduce((m, r) => m.set(custodianName(r.a, ctx.org.name), (m.get(custodianName(r.a, ctx.org.name)) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]);
  const recent = ctx.can("audit") ? await db.auditEvent.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }) : [];
  const now = new Date();
  const [openWo, overdueWo, transit] = await Promise.all([
    ctx.can("maintenance") ? db.workOrder.count({ where: { AND: [workOrderScope(ctx), { status: { in: OPEN_WO } }] } }) : 0,
    ctx.can("maintenance") ? db.workOrder.count({ where: { AND: [workOrderScope(ctx), { status: { in: OPEN_WO }, dueDate: { lt: now } }] } }) : 0,
    ctx.can("transfers") ? db.transfer.count({ where: { AND: [transferScope(ctx), { status: { in: ["requested", "approved", "in_transit", "disputed"] } }] } }) : 0,
  ]);
  const greeting = ctx.user.firstName ? `Hello, ${ctx.user.firstName}` : "Hello";

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={ctx.isSupplier ? `Molds held by ${ctx.membership.partner?.name} for ${ctx.org.name}.` : `${ctx.org.name} fleet overview.`}
        actions={<LinkButton href="/scan">Scan a QR tag</LinkButton>}
      />
      {sp.error === "forbidden" && <Notice tone="error">Your role does not have access to that page.</Notice>}
      {rows.length === 0 ? (
        <EmptyState
          title={ctx.isSupplier ? "No molds are in your custody yet" : "No assets yet"}
          body={ctx.isSupplier ? undefined : "Add sites and partners, then create assets one by one or import them from a spreadsheet."}
          action={!ctx.isSupplier && ctx.can("assets", "create") ? <div className="flex justify-center gap-2"><LinkButton href="/assets/new">New asset</LinkButton>{ctx.can("import_export", "create") && <LinkButton href="/import-export" variant="secondary">Import CSV</LinkButton>}</div> : undefined}
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat label={ctx.isSupplier ? "Molds in custody" : "Assets"} value={fmtNum(rows.length, ctx.org)} hint={`${molds.length} molds`} />
            <Stat label="Readings overdue" value={overdue.length} hint={<Link href="/assets?overdue=1" className="text-brand-700 hover:underline">No reading in {ctx.org.readingOverdueDays}+ days</Link>} />
            <Stat label="Near end of life" value={nearEol.length} hint="≥ 80% of end-of-life shots" />
            <Stat label="Lifetime shots (molds)" value={fmtNum(molds.reduce((s, r) => s + (r.l.lifetimeShots ?? 0), 0), ctx.org)} />
          </div>
          {(ctx.can("maintenance") || ctx.can("transfers")) && (
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              {ctx.can("maintenance") && <Stat label="Open work orders" value={openWo} hint={<Link href="/maintenance?view=open" className="text-brand-700 hover:underline">View work orders</Link>} />}
              {ctx.can("maintenance") && <Stat label="Overdue work" value={overdueWo} hint={<Link href="/maintenance?view=overdue" className="text-brand-700 hover:underline">Past due date</Link>} />}
              {ctx.can("transfers") && <Stat label="Transfers in progress" value={transit} hint={<Link href="/transfers?view=open" className="text-brand-700 hover:underline">Requested, shipped or disputed</Link>} />}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Shot readings overdue" className="lg:col-span-2">
              {overdue.length === 0 ? <p className="text-sm text-ink-500">All active molds have a recent reading.</p> : (
                <ul className="divide-y divide-gray-100">
                  {overdue.slice(0, 10).map(({ a, l }) => (
                    <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                      <span><Link href={`/assets/${a.id}?tab=counter`} className="font-medium hover:text-brand-700">{a.number}</Link> <span className="text-ink-700">{a.name}</span><span className="block text-xs text-ink-500">{custodianName(a, ctx.org.name)} · {a.site.name}</span></span>
                      <span className="text-xs text-ink-500">last {fmtDate(l.shots?.lastReadingAt, ctx.org.timezone)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Fleet by status">
              <ul className="space-y-1 text-sm">{byStatus.map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n}</span></li>)}</ul>
            </Card>
            <Card title="Approaching end of life" className="lg:col-span-2">
              {nearEol.length === 0 ? <p className="text-sm text-ink-500">No molds above 80% of their end-of-life shots.</p> : (
                <ul className="divide-y divide-gray-100">
                  {nearEol.slice(0, 10).map(({ a, l }) => (
                    <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                      <span><Link href={`/assets/${a.id}`} className="font-medium hover:text-brand-700">{a.number}</Link> <span className="text-ink-700">{a.name}</span></span>
                      <LifeBar pct={l.endOfLifePct ?? 0} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {!ctx.isSupplier && (
              <Card title="Custody">
                <ul className="space-y-1 text-sm">{byCustodian.map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n}</span></li>)}</ul>
              </Card>
            )}
            {recent.length > 0 && (
              <Card title="Recent activity" className="lg:col-span-3">
                <ul className="space-y-1 text-xs">
                  {recent.map((e) => <li key={e.id}><span className="text-ink-500">{fmtDateTime(e.createdAt, ctx.org.timezone)}</span> · {e.user?.email ?? "system"} {e.action.replace(/_/g, " ")} {e.entityType} <span className="font-medium">{e.entityLabel}</span></li>)}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
      {!ctx.isSupplier && byStatus.some(([k]) => k === label(ASSET_STATUS, "quarantined")) && (
        <p className="mt-4 text-xs"><Badge status="quarantined" /> Quarantined assets are blocked from use until cleared.</p>
      )}
    </>
  );
}
