import { requireOrg } from "@/lib/auth";
import { TIMEZONES } from "@/lib/india";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Card, Field, FlashFromParams, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["settings", "view"]);
  const o = ctx.org;
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
          {ctx.can("settings", "edit") && <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>}
        </form>
      </Card>
    </>
  );
}
