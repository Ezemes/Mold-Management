import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { DOWNTIME_CATEGORIES, downtimeScope, durationHours, fmtDuration, loadMetrics } from "@/lib/downtime";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cx, EmptyState, FlashFromParams, LinkButton, PageHeader, Stat, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CategoryBadge } from "@/components/downtime";
import { SubTabs } from "@/components/sub-tabs";
import { DOWNTIME_TABS } from "@/lib/tabs";
import { endDowntimeAction } from "./actions";

export const metadata = { title: "Downtime" };

const VIEWS = [["open", "Down now"], ["recent", "Last 90 days"], ["all", "All"]] as const;

export default async function DowntimePage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string; asset?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["downtime", "view"]);
  const tz = ctx.org.timezone;
  const now = new Date();
  const openCount = await db.downtimeEvent.count({ where: { AND: [downtimeScope(ctx), { endedAt: null }] } });
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? (openCount ? "open" : "recent");
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const where: Prisma.DowntimeEventWhereInput = {
    AND: [
      downtimeScope(ctx),
      view === "open" ? { endedAt: null } : view === "recent" ? { OR: [{ startedAt: { gte: since } }, { endedAt: null }] } : {},
      sp.category && sp.category in DOWNTIME_CATEGORIES ? { category: sp.category } : {},
      sp.asset ? { asset: { number: { equals: sp.asset, mode: "insensitive" } } } : {},
    ],
  };
  const start30 = new Date(now.getTime() - 30 * 86_400_000);
  const [events, m] = await Promise.all([
    db.downtimeEvent.findMany({ where, include: { asset: { select: { id: true, number: true, name: true } }, press: { select: { number: true } }, code: true, workOrder: { select: { id: true, number: true, status: true } } }, orderBy: { startedAt: "desc" }, take: 300 }),
    loadMetrics(ctx, start30, now),
  ]);
  const t = m.total;
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ view, category: sp.category, asset: sp.asset, ...o }).filter((e): e is [string, string] => !!e[1]));
    return `/downtime?${q}`;
  };
  return (
    <>
      <PageHeader
        title="Downtime"
        subtitle="When molds could not run, and why. Failures drive MTBF and MTTR; failures and planned stops reduce availability; external stops (press, material, orders) are recorded but not held against the mold."
        actions={ctx.can("downtime", "create") && <LinkButton href="/downtime/new">Record downtime</LinkButton>}
      />
      <SubTabs tabs={DOWNTIME_TABS} active="/downtime" />
      <FlashFromParams params={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Down now" value={t.openNow} hint={t.openNow ? "Open events" : "All molds running"} />
        <Stat label="Availability (30 days)" value={t.availabilityPct == null ? "—" : `${fmtNum(t.availabilityPct, ctx.org, 1)}%`} hint={`${fmtDuration(t.moldDownHours)} failure and planned downtime`} />
        <Stat label="MTBF (30 days)" value={fmtDuration(t.mtbfHours)} hint={`${t.failures} failure(s) across ${m.assets.length} mold(s)`} />
        <Stat label="MTTR (30 days)" value={fmtDuration(t.mttrHours)} hint={`${t.repairs} repair(s) finished`} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {VIEWS.map(([k, l]) => <Link key={k} href={href({ view: k })} className={cx("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}{k === "open" && ` (${openCount})`}</Link>)}
        <span className="mx-2 h-5 w-px bg-gray-200" />
        {Object.entries(DOWNTIME_CATEGORIES).map(([k, l]) => (
          <Link key={k} href={href({ category: sp.category === k ? undefined : k })} className={cx("rounded-full px-2.5 py-1 text-xs ring-1 ring-inset", sp.category === k ? "bg-ink-900 text-white ring-ink-900" : "text-ink-500 ring-gray-200 hover:bg-gray-50")}>{l}</Link>
        ))}
        {sp.asset && <Link href={href({ asset: undefined })} className="ml-2 rounded-full bg-gray-100 px-2.5 py-1 text-xs">{sp.asset} ✕</Link>}
      </div>
      {events.length === 0 ? (
        <EmptyState title={view === "open" ? "No mold is down" : "No downtime recorded"} body={view === "open" ? undefined : "Record downtime when a mold stops, or import it from a CSV file."} />
      ) : (
        <Table head={["Event", "Mold", "Reason", "Started", "Ended", "Duration", "Work order", ""]}>
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50">
              <Td><Link href={`/downtime/${e.id}`} className="font-medium hover:text-brand-700">{e.number}</Link></Td>
              <Td><Link href={`/assets/${e.asset.id}?tab=downtime`} className="hover:text-brand-700">{e.asset.number}</Link><p className="text-xs text-ink-500">{e.asset.name}{e.press && ` · on ${e.press.number}`}</p></Td>
              <Td className="text-xs"><CategoryBadge category={e.category} /> <span className="ml-1">{e.code.name}</span>{e.description && <p className="mt-0.5 line-clamp-1 text-ink-500">{e.description}</p>}</Td>
              <Td className="text-xs">{fmtDateTime(e.startedAt, tz)}</Td>
              <Td className="text-xs">{e.endedAt ? fmtDateTime(e.endedAt, tz) : <span className="font-medium text-red-700">Still down</span>}</Td>
              <Td className="text-xs">{fmtDuration(durationHours(e, now))}</Td>
              <Td className="text-xs">{e.workOrder ? <Link href={`/maintenance/work-orders/${e.workOrder.id}`} className="text-brand-700 hover:underline">{e.workOrder.number}</Link> : "—"}</Td>
              <Td>
                {!e.endedAt && ctx.can("downtime", "edit") && (
                  <form action={endDowntimeAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="return" value={href({})} />
                    <SubmitButton size="sm" variant="secondary" confirm={`End ${e.number} now? ${e.asset.number} will count as running again.`}>Back up</SubmitButton>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
