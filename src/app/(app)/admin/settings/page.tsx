import { requireOrg } from "@/lib/auth";
import { TIMEZONES } from "@/lib/india";
import { normalizeRules, RULES } from "@/lib/compat.pure";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Card, Field, FlashFromParams, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["settings", "view"]);
  const o = ctx.org;
  const rules = normalizeRules(o.compatRules);
  return (
    <>
      <PageHeader title="Organisation settings" subtitle="Defaults for India: IST, INR, metric units and lakh/crore number grouping." />
      <FlashFromParams params={sp} />
      <Card>
        <form action={saveSettingsAction} className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Organisation name" className="sm:col-span-2"><Input name="name" defaultValue={o.name} required /></Field>
          <Field label="Default time zone"><Select name="timezone" defaultValue={o.timezone} options={TIMEZONES.map((t) => [t, t] as [string, string])} /></Field>
          <Field label="Currency (ISO code)"><Input name="currency" defaultValue={o.currency} maxLength={3} /></Field>
          <Field label="Number format" hint={`Example: ${fmtNum(12345678, { numberFormat: o.numberFormat })} · ${fmtMoney(1250000, o)}`}><Select name="numberFormat" defaultValue={o.numberFormat} options={{ indian: "Indian (12,34,567)", international: "International (1,234,567)" }} /></Field>
          <Field label="Units"><Select name="unitSystem" defaultValue={o.unitSystem} options={{ metric: "Metric (mm, kg, t)", imperial: "Imperial (in, lb, US ton)" }} /></Field>
          <Field label="Shot reading overdue after (days)" hint="Active molds with no reading for this long are flagged."><Input name="readingOverdueDays" type="number" min={1} max={365} defaultValue={o.readingOverdueDays} /></Field>
          <Field label="Transfers need approval" hint="Cross-company = whenever the holding company changes."><Select name="transferApproval" defaultValue={o.transferApproval} options={{ cross_company: "Cross-company transfers", always: "Always", never: "Never" }} /></Field>
          <Field label="Handover shot tolerance" hint="Shots allowed between dispatch and receipt before a dispute is raised (e.g. trial shots)."><Input name="transferShotTolerance" type="number" min={0} defaultValue={o.transferShotTolerance} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="requalifyOnTransfer" defaultChecked={o.requalifyOnTransfer} /> Require re-qualification when a mold&apos;s custody moves to another site</label>

          <h2 className="mt-4 text-sm font-semibold sm:col-span-2">Press compatibility rules</h2>
          <div className="grid gap-1 sm:col-span-2 sm:grid-cols-2">
            {Object.entries(RULES).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`rule.${k}`} defaultChecked={rules.enabled[k as keyof typeof RULES]} /> {l}</label>
            ))}
          </div>
          <Field label="Tonnage margin (%)" hint="Press tonnage must exceed the mold's requirement by this much."><Input name="tonnageMarginPct" inputMode="decimal" defaultValue={rules.tonnageMarginPct} /></Field>
          <Field label="Locating-ring tolerance (mm)"><Input name="ringTolMm" inputMode="decimal" defaultValue={rules.ringTolMm} /></Field>
          <Field label="Shot size: min % of capacity"><Input name="shotMinPct" inputMode="decimal" defaultValue={rules.shotMinPct} /></Field>
          <Field label="Shot size: max % of capacity"><Input name="shotMaxPct" inputMode="decimal" defaultValue={rules.shotMaxPct} /></Field>

          <h2 className="mt-4 text-sm font-semibold sm:col-span-2">Capacity planning</h2>
          <Field label="Production hours per month" hint="Per mold, before OEE. 600 ≈ 25 days × 24 h."><Input name="capacityHoursPerMonth" type="number" min={1} max={744} defaultValue={o.capacityHoursPerMonth} /></Field>
          <Field label="Default OEE (%)"><Input name="defaultOeePct" type="number" min={1} max={100} defaultValue={o.defaultOeePct} /></Field>
          <Field label="Downtime per refurbishment (days)" hint="Removed from capacity in the forecast refurbishment month."><Input name="refurbDowntimeDays" type="number" min={0} max={365} defaultValue={o.refurbDowntimeDays} /></Field>

          <h2 className="mt-4 text-sm font-semibold sm:col-span-2">Shot reconciliation</h2>
          <Field label="Tolerance (%)" hint="Allowed gap between counted shots and parts ÷ cavities."><Input name="reconTolerancePct" type="number" min={0} max={100} defaultValue={o.reconTolerancePct} /></Field>
          <Field label="Minimum tolerance (shots)" hint="Small periods are never flagged for less than this."><Input name="reconMinShots" type="number" min={0} defaultValue={o.reconMinShots} /></Field>
          <Field label="Reading window (days)" hint="How close a counter reading must be to a period's start and end."><Input name="reconWindowDays" type="number" min={0} max={31} defaultValue={o.reconWindowDays} /></Field>
          {ctx.can("settings", "edit") && <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>}
        </form>
      </Card>
    </>
  );
}
