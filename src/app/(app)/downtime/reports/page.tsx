import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { combineStats, DOWNTIME_CATEGORIES, fmtDuration, loadMetrics, type DtStats } from "@/lib/downtime";
import { fmtNum } from "@/lib/format";
import { cx, FlashFromParams, PageHeader, Stat, Table, Td } from "@/components/ui";
import { CategoryBadge } from "@/components/downtime";
import { SubTabs } from "@/components/sub-tabs";
import { DOWNTIME_TABS } from "@/lib/tabs";

export const metadata = { title: "MTBF & availability" };

const PERIODS = [["30", "30 days"], ["90", "90 days"], ["365", "12 months"]] as const;
const GROUPS = [["mold", "By mold"], ["type", "By asset type"], ["site", "By site"]] as const;

export default async function DowntimeReportsPage({ searchParams }: { searchParams: Promise<{ days?: string; by?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["downtime", "view"]);
  const days = Number(PERIODS.find(([k]) => k === sp.days)?.[0] ?? 90);
  const by = GROUPS.find(([k]) => k === sp.by)?.[0] ?? "mold";
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const m = await loadMetrics(ctx, start, end);
  const codes = await db.downtimeCode.findMany({ where: { id: { in: m.byCode.map((c) => c.codeId) } } });
  const t = m.total;
  const pct = (v: number | null) => (v == null ? "—" : `${fmtNum(v, ctx.org, 1)}%`);
  const maxCodeHours = Math.max(1, ...m.byCode.map((c) => c.hours));

  type Row = { key: string; label: string; sub: string; href?: string; s: DtStats; n: number };
  let rows: Row[];
  if (by === "mold") {
    rows = m.assets.map((a) => ({ key: a.id, label: a.number, sub: `${a.name} · ${a.site.name}`, href: `/assets/${a.id}?tab=downtime`, s: m.perAsset.get(a.id)!, n: 1 }));
  } else {
    const groups = new Map<string, string[]>();
    for (const a of m.assets) {
      const g = by === "type" ? a.assetType.name : a.site.name;
      groups.set(g, [...(groups.get(g) ?? []), a.id]);
    }
    rows = [...groups].map(([g, ids]) => ({ key: g, label: g, sub: `${ids.length} mold(s)`, s: combineStats(ids.map((id) => m.perAsset.get(id)!)), n: ids.length }));
  }
  // Worst first: lowest availability, then most failures.
  rows.sort((a, b) => (a.s.availabilityPct ?? 101) - (b.s.availabilityPct ?? 101) || b.s.failures - a.s.failures || a.label.localeCompare(b.label));
  const q = (o: Record<string, string>) => `/downtime/reports?${new URLSearchParams({ days: String(days), by, ...o })}`;

  return (
    <>
      <PageHeader title="Downtime" subtitle="Availability = time not lost to failures or planned stops ÷ time tracked. MTBF = that running time ÷ failures. MTTR = average length of finished failure events. Time is calendar time, counted from when each mold was first tracked: its passport's creation or its earliest recorded downtime." />
      <SubTabs tabs={DOWNTIME_TABS} active="/downtime/reports" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {PERIODS.map(([k, l]) => <Link key={k} href={q({ days: k })} className={cx("rounded-md px-3 py-1.5 text-sm", String(days) === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
        <span className="mx-2 h-5 w-px self-center bg-gray-200" />
        {GROUPS.map(([k, l]) => <Link key={k} href={q({ by: k })} className={cx("rounded-md px-3 py-1.5 text-sm", by === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Availability" value={pct(t.availabilityPct)} hint={`${m.assets.length} mold(s)`} />
        <Stat label="MTBF" value={fmtDuration(t.mtbfHours)} hint={`${t.failures} failure(s)`} />
        <Stat label="MTTR" value={fmtDuration(t.mttrHours)} hint={`${t.repairs} finished repair(s)`} />
        <Stat label="Failure downtime" value={fmtDuration(t.failureHours)} hint={`Planned ${fmtDuration(t.plannedHours)}`} />
        <Stat label="External downtime" value={fmtDuration(t.externalHours)} hint="Not counted against molds" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">{GROUPS.find(([k]) => k === by)![1]}</h2>
          <Table head={[by === "mold" ? "Mold" : by === "type" ? "Asset type" : "Site", "Availability", "MTBF", "MTTR", "Failures", "Failure", "Planned", "External", "Down now"]} empty="No molds in your scope.">
            {rows.map((r) => (
              <tr key={r.key}>
                <Td>{r.href ? <Link href={r.href} className="font-medium hover:text-brand-700">{r.label}</Link> : <span className="font-medium">{r.label}</span>}<p className="text-xs text-ink-500">{r.sub}</p></Td>
                <Td className={cx("text-sm", r.s.availabilityPct != null && r.s.availabilityPct < 90 && "font-medium text-amber-700")}>{pct(r.s.availabilityPct)}</Td>
                <Td className="text-xs">{fmtDuration(r.s.mtbfHours)}</Td>
                <Td className="text-xs">{fmtDuration(r.s.mttrHours)}</Td>
                <Td className="text-xs">{r.s.failures}</Td>
                <Td className="text-xs">{r.s.failureHours ? fmtDuration(r.s.failureHours) : "—"}</Td>
                <Td className="text-xs">{r.s.plannedHours ? fmtDuration(r.s.plannedHours) : "—"}</Td>
                <Td className="text-xs">{r.s.externalHours ? fmtDuration(r.s.externalHours) : "—"}</Td>
                <Td className="text-xs">{r.s.openNow ? <span className="font-medium text-red-700">{r.n > 1 ? r.s.openNow : "Yes"}</span> : "—"}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Reasons by hours lost</h2>
          <Table head={["Reason", "Stops", "Hours"]} empty="No downtime in this period.">
            {m.byCode.map((c) => {
              const code = codes.find((x) => x.id === c.codeId);
              return (
                <tr key={c.codeId}>
                  <Td className="text-xs">
                    <span className="font-medium">{code?.code}</span> {code && <CategoryBadge category={code.category} />}
                    <p className="text-ink-500">{code?.name}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(c.hours / maxCodeHours) * 100}%` }} /></div>
                  </Td>
                  <Td className="text-xs">{c.count}</Td>
                  <Td className="text-xs">{fmtDuration(c.hours)}</Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-ink-500">{Object.values(DOWNTIME_CATEGORIES).join(", ")}: set per reason under Reason codes.</p>
        </div>
      </div>
    </>
  );
}
