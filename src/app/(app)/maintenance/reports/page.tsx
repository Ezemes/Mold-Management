import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { maintenanceMetrics, OPEN_WO, woCost, WO_TYPES, workOrderScope } from "@/lib/maintenance";
import { label } from "@/lib/labels";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { cx, FlashFromParams, PageHeader, Stat, Table, Td } from "@/components/ui";
import { MaintTabs } from "@/components/maint-tabs";
import { fmtDuration, loadMetrics } from "@/lib/downtime";

export const metadata = { title: "Maintenance compliance" };

const PERIODS = [["30", "30 days"], ["90", "90 days"], ["365", "12 months"]] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "view"]);
  const days = Number(PERIODS.find(([k]) => k === sp.days)?.[0] ?? 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const [wos, assetCount] = await Promise.all([
    db.workOrder.findMany({
      where: { AND: [workOrderScope(ctx), { OR: [{ createdAt: { gte: start } }, { completedAt: { gte: start } }, { dueDate: { gte: start, lte: end } }, { status: { in: OPEN_WO } }] }] },
      include: { asset: { select: { id: true, number: true, name: true } }, labor: true, parts: true },
    }),
    db.asset.count({ where: { AND: [assetScope(ctx), { status: { notIn: ["retired", "scrapped"] } }] } }),
  ]);
  const m = maintenanceMetrics(wos, start, end, assetCount);
  // MTBF and MTTR come from recorded downtime when there is any; otherwise they are estimated from corrective work orders.
  const dt = ctx.can("downtime") ? await loadMetrics(ctx, start, end) : null;
  const fromDowntime = !!dt && dt.eventCount > 0;
  const done = wos.filter((w) => w.status === "completed" && w.completedAt && w.completedAt >= start);
  const costs = done.map((w) => ({ w, c: woCost(w) }));
  const total = costs.reduce((s, x) => s + x.c.total, 0);
  const hours = costs.reduce((s, x) => s + x.c.hours, 0);
  const byType = Object.keys(WO_TYPES).map((t) => ({ t, n: done.filter((w) => w.type === t).length, cost: costs.filter((x) => x.w.type === t).reduce((s, x) => s + x.c.total, 0) })).filter((r) => r.n);
  const byAsset = Object.values(
    costs.reduce<Record<string, { id: string; number: string; name: string; n: number; corrective: number; cost: number; hours: number }>>((acc, { w, c }) => {
      const r = (acc[w.assetId] ??= { id: w.asset.id, number: w.asset.number, name: w.asset.name, n: 0, corrective: 0, cost: 0, hours: 0 });
      r.n++; r.cost += c.total; r.hours += c.hours; if (w.type === "corrective") r.corrective++;
      return acc;
    }, {}),
  ).sort((a, b) => b.cost - a.cost).slice(0, 15);
  const overdue = wos.filter((w) => OPEN_WO.includes(w.status) && w.dueDate && w.dueDate < end).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

  return (
    <>
      <PageHeader title="Maintenance" subtitle="PM compliance counts planned and inspection work due in the period that was completed by its due date." />
      <MaintTabs active="/maintenance/reports" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex gap-1">
        {PERIODS.map(([k, l]) => <Link key={k} href={`/maintenance/reports?days=${k}`} className={cx("rounded-md px-3 py-1.5 text-sm", String(days) === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="PM compliance" value={pct(m.pmCompliancePct)} hint={`${m.pmOnTime} of ${m.pmDue} on time`} />
        <Stat label="Overdue now" value={m.overdue} hint="Open work past its due date" />
        {fromDowntime ? <Stat label="MTTR" value={fmtDuration(dt.total.mttrHours)} hint={<Link href="/downtime/reports" className="hover:underline">From downtime: {dt.total.repairs} repair(s)</Link>} /> : <Stat label="MTTR" value={m.mttrHours == null ? "—" : `${fmtNum(m.mttrHours, ctx.org, 1)} h`} hint="Corrective work orders: raised → completed" />}
        {fromDowntime ? <Stat label="MTBF" value={fmtDuration(dt.total.mtbfHours)} hint={<Link href="/downtime/reports" className="hover:underline">From downtime: {dt.total.failures} failure(s), {dt.total.availabilityPct == null ? "—" : `${fmtNum(dt.total.availabilityPct, ctx.org, 1)}%`} available</Link>} /> : <Stat label="MTBF" value={m.mtbfDays == null ? "—" : `${fmtNum(m.mtbfDays, ctx.org)} d`} hint={`Corrective work orders: ${m.failures} across ${assetCount} asset(s)`} />}
        <Stat label="Maintenance spend" value={fmtMoney(total, ctx.org)} hint={`${done.length} completed · ${fmtNum(hours, ctx.org, 1)} h`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Overdue work</h2>
          <Table head={["Work order", "Asset", "Due"]} empty="Nothing overdue.">
            {overdue.slice(0, 20).map((w) => (
              <tr key={w.id}>
                <Td><Link href={`/maintenance/work-orders/${w.id}`} className="font-medium hover:text-brand-700">{w.number}</Link><p className="text-xs text-ink-500">{w.title}</p></Td>
                <Td className="text-xs">{w.asset.number}</Td>
                <Td className="text-xs text-amber-700">{fmtDate(w.dueDate, ctx.org.timezone)}</Td>
              </tr>
            ))}
          </Table>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Completed by type</h2>
          <Table head={["Type", "Completed", "Cost"]} empty="Nothing completed in this period.">
            {byType.map((r) => <tr key={r.t}><Td>{label(WO_TYPES, r.t)}</Td><Td>{r.n}</Td><Td>{fmtMoney(r.cost, ctx.org)}</Td></tr>)}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Highest-cost assets</h2>
          <Table head={["Asset", "Jobs", "Corrective", "Hours", "Cost"]} empty="Nothing completed in this period.">
            {byAsset.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/assets/${r.id}?tab=maintenance`} className="font-medium hover:text-brand-700">{r.number}</Link><p className="text-xs text-ink-500">{r.name}</p></Td>
                <Td>{r.n}</Td><Td>{r.corrective}</Td><Td>{fmtNum(r.hours, ctx.org, 1)}</Td><Td>{fmtMoney(r.cost, ctx.org)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}
