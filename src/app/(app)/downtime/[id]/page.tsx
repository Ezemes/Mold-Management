import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { CATEGORY_HELP, downtimeCodes, downtimeScope, durationHours, fmtDuration, type DowntimeCategory } from "@/lib/downtime";
import { dateToLocalInput, fmtDateTime } from "@/lib/format";
import { Card, Field, FlashFromParams, Input, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CategoryBadge, CodeSelect } from "@/components/downtime";
import { deleteDowntimeAction, endDowntimeAction, updateDowntimeAction } from "../actions";

export const metadata = { title: "Downtime event" };

export default async function DowntimeEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["downtime", "view"]);
  const tz = ctx.org.timezone;
  const e = await db.downtimeEvent.findFirst({
    where: { AND: [downtimeScope(ctx), { id }] },
    include: { asset: { select: { id: true, number: true, name: true } }, press: { select: { id: true, number: true } }, code: true, workOrder: { select: { id: true, number: true, title: true, status: true } } },
  });
  if (!e) notFound();
  const [users, history, codes] = await Promise.all([
    db.user.findMany({ where: { id: { in: [e.reportedById, e.endedById].filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
    db.auditEvent.findMany({ where: { orgId: ctx.org.id, entityType: "downtime", entityId: e.id }, include: { user: true }, orderBy: { createdAt: "desc" } }),
    ctx.can("downtime", "edit") ? downtimeCodes(ctx.org.id, false) : Promise.resolve([]),
  ]);
  const who = (uid: string | null) => { const u = users.find((x) => x.id === uid); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const hid = <input type="hidden" name="id" value={e.id} />;
  return (
    <>
      <PageHeader
        back={{ href: "/downtime", label: "Downtime" }}
        title={<span className="flex flex-wrap items-center gap-2">{e.number} · {e.asset.number} <CategoryBadge category={e.category} />{!e.endedAt && <span className="text-sm font-medium text-red-700">Still down</span>}</span>}
        subtitle={<>{e.code.code} · {e.code.name} · <Link href={`/assets/${e.asset.id}?tab=downtime`} className="text-brand-700 hover:underline">{e.asset.name}</Link></>}
      />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Event">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-ink-500">Started</dt><dd>{fmtDateTime(e.startedAt, tz)}</dd></div>
              <div><dt className="text-xs text-ink-500">Ended</dt><dd>{e.endedAt ? fmtDateTime(e.endedAt, tz) : "—"}</dd></div>
              <div><dt className="text-xs text-ink-500">Duration</dt><dd>{fmtDuration(durationHours(e))}{!e.endedAt && " so far"}</dd></div>
              <div><dt className="text-xs text-ink-500">Press</dt><dd>{e.press ? <Link href={`/assets/${e.press.id}`} className="text-brand-700 hover:underline">{e.press.number}</Link> : "—"}</dd></div>
              <div><dt className="text-xs text-ink-500">Work order</dt><dd>{e.workOrder ? <Link href={`/maintenance/work-orders/${e.workOrder.id}`} className="text-brand-700 hover:underline">{e.workOrder.number} ({e.workOrder.status.replace("_", " ")})</Link> : "—"}</dd></div>
              <div><dt className="text-xs text-ink-500">Recorded</dt><dd>{who(e.reportedById)} · {e.source}</dd></div>
            </dl>
            {e.description && <p className="mt-4 whitespace-pre-wrap text-sm">{e.description}</p>}
            <p className="mt-4 text-xs text-ink-500">{CATEGORY_HELP[e.category as DowntimeCategory]}</p>
            {e.workOrder && !e.endedAt && <p className="mt-2 text-xs text-ink-500">Completing {e.workOrder.number} ends this event automatically.</p>}
          </Card>
          {ctx.can("downtime", "edit") && (
            <Card title="Correct this event">
              <form action={updateDowntimeAction} className="space-y-4">
                {hid}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Reason" name="codeId"><CodeSelect codes={codes} defaultValue={e.codeId} /></Field>
                  <Field label="Press" name="press"><Input name="press" defaultValue={e.press?.number ?? ""} /></Field>
                  <Field label={`Started (${tz})`} name="startedAt"><Input name="startedAt" type="datetime-local" required defaultValue={dateToLocalInput(e.startedAt, tz)} /></Field>
                  <Field label={`Ended (${tz})`} name="endedAt" hint="Blank = still down"><Input name="endedAt" type="datetime-local" defaultValue={e.endedAt ? dateToLocalInput(e.endedAt, tz) : ""} /></Field>
                  <Field label="Work order" name="workOrder"><Input name="workOrder" defaultValue={e.workOrder?.number ?? ""} /></Field>
                  <Field label="Why are you changing it?" name="reason"><Input name="reason" required placeholder="e.g. Wrong start time entered" /></Field>
                </div>
                <Field label="What happened" name="description"><Textarea name="description" defaultValue={e.description} /></Field>
                <SubmitButton variant="secondary">Save changes</SubmitButton>
              </form>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {!e.endedAt && ctx.can("downtime", "edit") && (
            <Card title="Mold running again?">
              <form action={endDowntimeAction} className="space-y-3">
                {hid}
                <Field label={`Back up at (${tz})`} name="endedAt"><Input name="endedAt" type="datetime-local" defaultValue={dateToLocalInput(new Date(), tz)} /></Field>
                <Field label="Note (optional)" name="note"><Input name="note" /></Field>
                <SubmitButton>End downtime</SubmitButton>
              </form>
            </Card>
          )}
          <Card title="History">
            {history.length === 0 ? <p className="text-sm text-ink-500">No changes.</p> : (
              <ul className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{h.action.replace("downtime_", "").replace("_", " ")}</span> · {h.user ? `${h.user.firstName} ${h.user.lastName}` : "System"}
                    <p className="text-xs text-ink-500">{fmtDateTime(h.createdAt, tz)}{h.reason && ` · ${h.reason}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {ctx.can("downtime", "delete") && (
            <Card title="Delete">
              <form action={deleteDowntimeAction} className="space-y-3">
                {hid}
                <Field label="Reason" name="reason"><Input name="reason" required placeholder="e.g. Recorded twice" /></Field>
                <SubmitButton variant="danger" confirm={`Delete ${e.number}? This cannot be undone.`}>Delete event</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
