import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { pressScope } from "@/lib/compat";
import { CATEGORY_HELP, DOWNTIME_CATEGORIES, downtimeCodes, type DowntimeCategory } from "@/lib/downtime";
import { OPEN_WO } from "@/lib/maintenance";
import { dateToLocalInput } from "@/lib/format";
import { Card, Field, FlashFromParams, Input, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CodeSelect } from "@/components/downtime";
import { recordDowntimeAction } from "../actions";

export const metadata = { title: "Record downtime" };

export default async function NewDowntimePage({ searchParams }: { searchParams: Promise<{ asset?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["downtime", "create"]);
  const tz = ctx.org.timezone;
  const asset = sp.asset ? await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: sp.asset, mode: "insensitive" } }] }, select: { id: true, number: true, name: true } }) : null;
  const [codes, presses, wos, open] = await Promise.all([
    downtimeCodes(ctx.org.id),
    db.asset.findMany({ where: pressScope(ctx), select: { number: true, name: true }, orderBy: { number: "asc" }, take: 500 }),
    asset && ctx.can("maintenance") ? db.workOrder.findMany({ where: { assetId: asset.id, status: { in: OPEN_WO } }, select: { number: true, title: true }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
    asset ? db.downtimeEvent.findFirst({ where: { assetId: asset.id, endedAt: null }, select: { id: true, number: true } }) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="Record downtime" back={{ href: "/downtime", label: "Downtime" }} subtitle="Leave the end blank while the mold is still down, and end it when it runs again." />
      <FlashFromParams params={sp} />
      {open && <p className="mb-4 text-sm text-amber-700">{asset!.number} is already down (<a className="underline" href={`/downtime/${open.id}`}>{open.number}</a>). End that event before recording a new one.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form action={recordDowntimeAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mold (asset number)" name="asset" hint={asset ? asset.name : undefined}><Input name="asset" required defaultValue={asset?.number ?? sp.asset ?? ""} placeholder="M-0001" /></Field>
              <Field label="Reason" name="codeId"><CodeSelect codes={codes} /></Field>
              <Field label={`Started (${tz})`} name="startedAt"><Input name="startedAt" type="datetime-local" required defaultValue={dateToLocalInput(new Date(), tz)} /></Field>
              <Field label={`Ended (${tz})`} name="endedAt" hint="Blank = still down"><Input name="endedAt" type="datetime-local" /></Field>
              <Field label="Press (optional)" name="press" hint="The press the mold was in">
                <Input name="press" list="presses" placeholder="P-0001" />
                <datalist id="presses">{presses.map((p) => <option key={p.number} value={p.number}>{p.name}</option>)}</datalist>
              </Field>
              <Field label="Existing work order (optional)" name="workOrder" hint={wos.length ? `Open on this mold: ${wos.map((w) => w.number).join(", ")}` : undefined}>
                <Input name="workOrder" list="wos" placeholder="WO-00001" />
                <datalist id="wos">{wos.map((w) => <option key={w.number} value={w.number}>{w.title}</option>)}</datalist>
              </Field>
            </div>
            <Field label="What happened" name="description"><Textarea name="description" placeholder="e.g. Water leak on cavity 3 cooling circuit" /></Field>
            {ctx.can("maintenance", "create") && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="raiseWorkOrder" className="mt-1" />
                <span>Raise a work order for the repair<span className="block text-xs text-ink-500">Completing that work order ends this downtime automatically.</span></span>
              </label>
            )}
            <SubmitButton pendingText="Saving…">Record downtime</SubmitButton>
          </form>
        </Card>
        <Card title="Categories">
          <dl className="space-y-3 text-sm">
            {(Object.keys(DOWNTIME_CATEGORIES) as DowntimeCategory[]).map((c) => <div key={c}><dt className="font-medium">{DOWNTIME_CATEGORIES[c]}</dt><dd className="text-xs text-ink-500">{CATEGORY_HELP[c]}</dd></div>)}
          </dl>
        </Card>
      </div>
    </>
  );
}
