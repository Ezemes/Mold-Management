import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { capacityPlan, fleetForecast, monthKey, monthKeys, monthStart, parseMonth, toCapacityMolds, type CapacityMold } from "@/lib/planning";
import { fmtNum } from "@/lib/format";
import { Card, cx, EmptyState, Field, FlashFromParams, Input, Notice, PageHeader, Stat, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { PLANNING_TABS } from "@/lib/tabs";
import { importDemandAction } from "../actions";

export const metadata = { title: "Capacity plan" };

type SP = { oee?: string; hours?: string; exclude?: string; hpart?: string; hcav?: string; hcycle?: string; hfrom?: string; error?: string; ok?: string };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (k: string) => `${MONTH_NAMES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`;

export default async function CapacityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["planning", "view"]);
  const now = new Date();
  const months = monthKeys(now, 12);
  const num = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return v && Number.isFinite(n) && n >= min && n <= max ? n : d; };
  const settings = { oeePct: num(sp.oee, ctx.org.defaultOeePct, 1, 100), hoursPerMonth: num(sp.hours, ctx.org.capacityHoursPerMonth, 1, 744), refurbDowntimeDays: ctx.org.refurbDowntimeDays };
  const excluded = new Set((sp.exclude ?? "").split(/[\s,;]+/).map((s) => s.toUpperCase()).filter(Boolean));

  const fleet = await fleetForecast(ctx, now);
  // A what-if OEE or hours figure replaces every site's own value; otherwise each site's shift pattern applies.
  let molds: CapacityMold[] = toCapacityMolds(fleet)
    .filter((m) => !excluded.has(m.number.toUpperCase()))
    .map((m) => ({ ...m, ...(sp.oee ? { oeePct: null } : {}), ...(sp.hours ? { hoursPerMonth: null } : {}) }));
  // What-if: a hypothetical extra mold for one product from a given month.
  const hpart = sp.hpart?.trim().toUpperCase();
  const hcav = num(sp.hcav, 0, 1, 256);
  const hcycle = num(sp.hcycle, 0, 1, 3600);
  const hfrom = sp.hfrom ? parseMonth(sp.hfrom) : months[0];
  if (hpart && hcav && hcycle && hfrom) {
    molds = [...molds, { id: "what-if", number: "WHAT-IF", cycleS: hcycle, activeCavities: hcav, products: [{ partNumber: hpart, cavities: null }], refurbMonths: [], eolMonth: null, fromMonth: hfrom, hypothetical: true }];
  }
  const demand = await db.productDemand.findMany({ where: { orgId: ctx.org.id, month: { gte: monthStart(months[0]), lte: monthStart(months[months.length - 1]) } } });
  const plan = capacityPlan(demand.map((d) => ({ partNumber: d.partNumber, month: monthKey(d.month), quantity: d.quantity })), molds, months, settings);
  const noPress = fleet.filter((r) => r.asset.products.length && r.approvedPresses === 0 && !excluded.has(r.asset.number.toUpperCase()));
  const noCycle = fleet.filter((r) => r.asset.products.length && !r.asset.designCycleTimeS);
  const whatIf = sp.oee || sp.hours || sp.exclude || hpart;

  return (
    <>
      <PageHeader title="Planning" subtitle="Monthly demand per product against the capacity of the molds that make it: active cavities × 3600 / cycle time × hours × OEE, less refurbishment downtime and nothing after end of life. Hours and OEE come from each site's shift pattern where recorded, else the organisation defaults below." />
      <SubTabs tabs={PLANNING_TABS} active="/planning/capacity" />
      <FlashFromParams params={sp} />
      <Card title="What-if" className="mb-4">
        <form className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Field label="OEE %" name="oee"><Input name="oee" inputMode="numeric" defaultValue={settings.oeePct} /></Field>
          <Field label="Hours / month" name="hours"><Input name="hours" inputMode="numeric" defaultValue={settings.hoursPerMonth} /></Field>
          <Field label="Without molds" name="exclude" className="sm:col-span-2"><Input name="exclude" defaultValue={sp.exclude ?? ""} placeholder="M-0003, M-0005" /></Field>
          <Field label="Extra mold for part" name="hpart"><Input name="hpart" defaultValue={sp.hpart ?? ""} placeholder="Part no." /></Field>
          <Field label="Cavities" name="hcav"><Input name="hcav" inputMode="numeric" defaultValue={sp.hcav ?? ""} /></Field>
          <Field label="Cycle (s)" name="hcycle"><Input name="hcycle" inputMode="decimal" defaultValue={sp.hcycle ?? ""} /></Field>
          <Field label="From (YYYY-MM)" name="hfrom"><Input name="hfrom" defaultValue={sp.hfrom ?? ""} placeholder={months[0]} /></Field>
          <div className="flex items-end gap-2 sm:col-span-4 lg:col-span-8">
            <button className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Recalculate</button>
            {whatIf && <Link href="/planning/capacity" className="px-2 text-sm text-ink-500 hover:text-brand-700">Reset to plan</Link>}
          </div>
        </form>
      </Card>
      {whatIf && <Notice tone="info">Showing a what-if scenario. Nothing is saved.</Notice>}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Products planned" value={plan.rows.length} />
        <Stat label="Shortfall months" value={<span className={cx(plan.shortfalls > 0 && "text-red-700")}>{plan.shortfalls}</span>} hint="Product-months where demand exceeds capacity" />
        <Stat label="Molds without an approved press" value={noPress.length} hint={noPress.slice(0, 4).map((r) => r.asset.number).join(", ") || "All qualified"} />
      </div>
      {noCycle.length > 0 && <Notice tone="warn">No design cycle time on {noCycle.map((r) => r.asset.number).join(", ")}; they add no capacity until it is recorded.</Notice>}

      {plan.rows.length === 0 ? <EmptyState title="No products to plan" body="Link products to molds on their passports and import monthly demand below." /> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                {months.map((m) => <th key={m} className="px-2 py-2 font-medium">{short(m)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plan.rows.map((r) => (
                <tr key={r.partNumber}>
                  <td className="px-3 py-2 text-left">
                    <p className="font-medium text-ink-900">{r.partNumber}</p>
                    <p className="text-ink-500">{r.makers.join(", ") || "no mold"}</p>
                  </td>
                  {months.map((m) => {
                    const c = r.cells[m];
                    return (
                      <td key={m} className={cx("px-2 py-2 tabular-nums", c.gap < 0 ? "bg-red-50 text-red-800" : c.utilisationPct != null && c.utilisationPct > 85 ? "bg-amber-50" : "")} title={c.molds.map((x) => `${x.number}: ${x.capacity.toLocaleString("en-IN")}`).join("\n")}>
                        <span className="block">{fmtNum(c.demand, ctx.org)}</span>
                        <span className="block text-ink-500">/ {fmtNum(c.capacity, ctx.org)}</span>
                        {c.utilisationPct != null && Number.isFinite(c.utilisationPct) && <span className="block text-[10px] text-ink-500">{Math.round(c.utilisationPct)}%</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-3 py-2 text-left text-xs text-ink-500">Each cell: demand / capacity, and utilisation. Red = shortfall, amber = above 85%. Hover a cell for capacity by mold.</p>
        </div>
      )}

      {ctx.can("planning", "edit") && (
        <Card title="Import demand" className="mt-6 max-w-2xl">
          <form action={importDemandAction} className="space-y-3">
            <Field label="Rows" name="rows" hint="part_number, month (YYYY-MM), quantity — one per line. A quantity of 0 removes that month.">
              <Textarea name="rows" rows={5} placeholder={"TN-0001-A, 2026-11, 120000\nTN-0001-A, 2026-12, 140000"} className="font-mono text-xs" />
            </Field>
            <Field label="…or a CSV file" name="file"><input type="file" name="file" accept=".csv,text/csv" className="block text-sm" /></Field>
            <SubmitButton pendingText="Importing…">Save demand</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
