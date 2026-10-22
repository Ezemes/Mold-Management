import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { fleetForecast } from "@/lib/planning";
import { fmtDate, fmtNum } from "@/lib/format";
import { cx, FlashFromParams, PageHeader, Stat, Table, Td } from "@/components/ui";
import { LifeBar } from "@/components/life-bar";
import { SubTabs } from "@/components/sub-tabs";
import { PLANNING_TABS } from "@/lib/tabs";

export const metadata = { title: "Life forecast" };

const DAY = 86_400_000;

export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ within?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["planning", "view"]);
  const now = new Date();
  const within = sp.within === "90" ? 90 : null;
  const rows = await fleetForecast(ctx, now);
  const limit = new Date(now.getTime() + 90 * DAY);
  const soon = (d: Date | null | undefined) => !!d && d <= limit;
  const due = (r: (typeof rows)[number]) => soon(r.forecast.refurbs[0]?.date) || soon(r.forecast.eol?.date);
  const shown = (within ? rows.filter(due) : rows).sort((a, b) => (a.forecast.eol?.date?.getTime() ?? Infinity) - (b.forecast.eol?.date?.getTime() ?? Infinity));
  const tz = ctx.org.timezone;
  const when = (d: Date | null | undefined, shots?: number) =>
    d === undefined ? <span className="text-ink-500">—</span> : d === null ? <span className="text-xs text-ink-500">{shots != null ? `at ${fmtNum(shots, ctx.org)} · ` : ""}no shot rate</span> : (
      <span className={cx(soon(d) && "font-medium text-amber-700")}>{d <= now ? "Now" : fmtDate(d, tz)}{shots != null && <span className="block text-xs font-normal text-ink-500">at {fmtNum(shots, ctx.org)}</span>}</span>
    );
  return (
    <>
      <PageHeader title="Planning" subtitle="Forecast from each mold's shots per month over the last 90 days of readings. Dates within 90 days are highlighted." />
      <SubTabs tabs={PLANNING_TABS} active="/planning/forecast" />
      <FlashFromParams params={sp} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Molds forecast" value={rows.length} hint={`${rows.filter((r) => r.rate == null).length} without enough readings`} />
        <Stat label="Refurbishment in 90 days" value={rows.filter((r) => soon(r.forecast.refurbs[0]?.date)).length} />
        <Stat label="End of life in 90 days" value={rows.filter((r) => soon(r.forecast.eol?.date)).length} />
      </div>
      <div className="mb-4 flex gap-1 text-sm">
        {[["", "All molds"], ["90", "Due in 90 days"]].map(([k, l]) => <Link key={k} href={`/planning/forecast${k ? `?within=${k}` : ""}`} className={cx("rounded-md px-3 py-1.5", (sp.within ?? "") === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
      </div>
      <Table head={["Mold", "Held by", "Lifetime shots", "Shots / month", "Life used", "Next refurbishment", "Warranty ends", "End of life"]} empty="Nothing due in the next 90 days.">
        {shown.map((r) => (
          <tr key={r.asset.id}>
            <Td><Link href={`/assets/${r.asset.id}`} className="font-medium hover:text-brand-700">{r.asset.number}</Link><p className="text-xs text-ink-500">{r.asset.name}</p></Td>
            <Td className="text-xs">{r.asset.custodianPartner?.name ?? ctx.org.name}<p className="text-ink-500">{r.asset.site.name}</p></Td>
            <Td>{fmtNum(r.lifetime, ctx.org)}</Td>
            <Td>{r.rate == null ? <span className="text-xs text-ink-500">—</span> : fmtNum(r.rate, ctx.org)}</Td>
            <Td>{r.forecast.eol ? <LifeBar pct={r.forecast.eol.pct} /> : "—"}</Td>
            <Td>{when(r.forecast.refurbs[0]?.date, r.forecast.refurbs[0]?.shots)}</Td>
            <Td>{when(r.forecast.warranty?.date, r.forecast.warranty?.shots)}</Td>
            <Td>{when(r.forecast.eol?.date, r.forecast.eol?.shots)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
