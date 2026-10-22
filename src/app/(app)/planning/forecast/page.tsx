import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { fleetForecast } from "@/lib/planning";
import { fmtDate, fmtNum } from "@/lib/format";
import { cx, FlashFromParams, PageHeader, Stat, Table, Td } from "@/components/ui";
import { CalcValue } from "@/components/calc-value";
import { calculate, inputFromAsset } from "@/lib/calc.pure";
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
  const calc = (r: (typeof rows)[number]) => calculate(inputFromAsset(r.asset, ctx.org), now).lifecycle;
  const nextRefurb = (r: (typeof rows)[number]) => calc(r).nextRefurbishment.value ?? r.forecast.refurbs[0]?.date ?? null;
  const eol = (r: (typeof rows)[number]) => calc(r).expectedEndOfLife.value ?? r.forecast.eol?.date ?? null;
  const due = (r: (typeof rows)[number]) => soon(nextRefurb(r)) || soon(eol(r));
  const shown = (within ? rows.filter(due) : rows).sort((a, b) => (eol(a)?.getTime() ?? Infinity) - (eol(b)?.getTime() ?? Infinity));
  const tz = ctx.org.timezone;
  return (
    <>
      <PageHeader title="Planning" subtitle="Next refurbishment, end of life and priority are the calculated fields (cycle count, shots between refurbishments, refurbishments allowed and annual volume). “At current pace” uses the last 90 days of shot readings instead. Dates within 90 days are highlighted." />
      <SubTabs tabs={PLANNING_TABS} active="/planning/forecast" />
      <FlashFromParams params={sp} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Molds forecast" value={rows.length} hint={`${rows.filter((r) => r.rate == null).length} without enough readings`} />
        <Stat label="Refurbishment in 90 days" value={rows.filter((r) => soon(nextRefurb(r))).length} />
        <Stat label="End of life in 90 days" value={rows.filter((r) => soon(eol(r))).length} />
      </div>
      <div className="mb-4 flex gap-1 text-sm">
        {[["", "All molds"], ["90", "Due in 90 days"]].map(([k, l]) => <Link key={k} href={`/planning/forecast${k ? `?within=${k}` : ""}`} className={cx("rounded-md px-3 py-1.5", (sp.within ?? "") === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
      </div>
      <Table head={["Mold", "Held by", "Lifetime shots", "Refurb. priority", "Next refurbishment", "Expected end of life", "Remaining life", "Shots / month"]} empty="Nothing due in the next 90 days.">
        {shown.map((r) => {
          const c = calc(r);
          return (
            <tr key={r.asset.id}>
              <Td><Link href={`/assets/${r.asset.id}?tab=calculated`} className="font-medium hover:text-brand-700">{r.asset.number}</Link><p className="text-xs text-ink-500">{r.asset.name}</p></Td>
              <Td className="text-xs">{r.asset.custodianPartner?.name ?? ctx.org.name}<p className="text-ink-500">{r.asset.site.name}</p></Td>
              <Td>{fmtNum(r.lifetime, ctx.org)}</Td>
              <Td><CalcValue k="refurbishmentPriority" c={c.refurbishmentPriority} org={ctx.org} currency={ctx.org.cavityCostCurrency} /></Td>
              <Td><span className={cx(soon(c.nextRefurbishment.value) && "font-medium text-amber-700")}><CalcValue k="nextRefurbishment" c={c.nextRefurbishment} org={ctx.org} currency={ctx.org.cavityCostCurrency} /></span>{r.forecast.refurbs[0]?.date && <p className="text-xs text-ink-500">at current pace {fmtDate(r.forecast.refurbs[0].date, tz)}</p>}</Td>
              <Td><span className={cx(soon(c.expectedEndOfLife.value) && "font-medium text-amber-700")}><CalcValue k="expectedEndOfLife" c={c.expectedEndOfLife} org={ctx.org} currency={ctx.org.cavityCostCurrency} /></span>{r.forecast.eol?.date && <p className="text-xs text-ink-500">at current pace {fmtDate(r.forecast.eol.date, tz)}</p>}</Td>
              <Td><CalcValue k="remainingLifePct" c={c.remainingLifePct} org={ctx.org} currency={ctx.org.cavityCostCurrency} /></Td>
              <Td>{r.rate == null ? <span className="text-xs text-ink-500">—</span> : fmtNum(r.rate, ctx.org)}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
