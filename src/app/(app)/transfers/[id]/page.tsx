import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { actsFor, HANDOVER_CHECKLIST, TRANSFER_REASONS, TRANSFER_STATUS, transferScope, type HandoverCheck } from "@/lib/transfers";
import { label } from "@/lib/labels";
import { dateToLocalInput, fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { Badge, Card, Field, FlashFromParams, Input, Notice, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { cancelTransferAction, decideTransferAction, receiveTransferAction, resolveDisputeAction, shipTransferAction, submitTransferAction } from "../actions";

const STEPS = ["requested", "approved", "in_transit", "completed"] as const;
const STEP_LABEL = { requested: "Requested", approved: "Approved", in_transit: "Shipped", completed: "Received" };

function ChecklistInputs({ itemId, previous }: { itemId: string; previous?: HandoverCheck[] }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {HANDOVER_CHECKLIST.map((c) => {
        const prev = previous?.find((p) => p.key === c.key);
        return (
          <div key={c.key} className="flex items-center gap-2 rounded border border-gray-100 px-2 py-1 text-xs">
            <select name={`${itemId}.check.${c.key}`} defaultValue="ok" className="rounded border border-gray-200 px-1 py-0.5" aria-label={c.label}>
              <option value="ok">OK</option>
              <option value="fail">Issue</option>
            </select>
            <span className="flex-1">{c.label}{prev && !prev.ok && <span className="text-amber-700"> (issue at dispatch)</span>}</span>
            <input name={`${itemId}.note.${c.key}`} placeholder="note" className="w-24 rounded border border-gray-200 px-1 py-0.5" />
          </div>
        );
      })}
    </div>
  );
}

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["transfers", "view"]);
  const t = await db.transfer.findFirst({
    where: { AND: [transferScope(ctx), { id }] },
    include: {
      fromSite: true, toSite: true, fromPartner: true, toPartner: true,
      items: { include: { asset: { include: { meters: true } }, handovers: true, disputes: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) notFound();
  const tz = ctx.org.timezone;
  const org = ctx.org;
  const people = await db.user.findMany({ where: { id: { in: [t.createdById, t.approvedById, t.shippedById, t.receivedById].filter((x): x is string => !!x) } }, select: { id: true, email: true } });
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.email ?? "—";
  const handoverIds = t.items.flatMap((i) => i.handovers.map((h) => h.id));
  const attachments = handoverIds.length ? await db.attachment.findMany({ where: { ownerType: "handover", ownerId: { in: handoverIds } } }) : [];
  const hid = <input type="hidden" name="id" value={t.id} />;
  const canShip = t.status === "approved" && ctx.can("transfers", "edit") && actsFor(ctx, t.fromSite);
  const canReceive = t.status === "in_transit" && ctx.can("transfers", "edit") && actsFor(ctx, t.toSite);
  const canDecide = t.status === "requested" && ctx.can("transfers", "approve") && !ctx.isSupplier;
  const canResolve = t.status === "disputed" && ctx.can("transfers", "approve") && !ctx.isSupplier;
  const stepIdx = STEPS.indexOf((t.status === "disputed" ? "completed" : t.status) as (typeof STEPS)[number]);
  const fromName = t.fromPartner?.name ?? org.name;
  const toName = t.toPartner?.name ?? org.name;

  return (
    <>
      <PageHeader
        back={{ href: "/transfers", label: "Transfers" }}
        title={<span className="flex items-center gap-3">{t.number} <Badge status={t.status === "completed" ? "active" : t.status === "disputed" ? "quarantined" : t.status === "rejected" || t.status === "cancelled" ? "archived" : "pending"}>{label(TRANSFER_STATUS, t.status)}</Badge></span>}
        subtitle={`${fromName} · ${t.fromSite.name} → ${toName} · ${t.toSite.name} · ${label(TRANSFER_REASONS, t.reason)}`}
        actions={
          <>
            {t.status === "draft" && ctx.can("transfers", "create") && <form action={submitTransferAction}>{hid}<SubmitButton>Submit</SubmitButton></form>}
          </>
        }
      />
      <FlashFromParams params={sp} />

      {!["rejected", "cancelled", "draft"].includes(t.status) && (
        <ol className="mb-6 grid grid-cols-4 gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-md border px-3 py-2 ${i <= stepIdx ? "border-brand-200 bg-brand-50 text-brand-700" : "border-gray-200 text-ink-500"}`}>
              <p className="font-medium">{STEP_LABEL[s]}</p>
              <p>{s === "requested" ? fmtDateTime(t.requestedAt, tz) : s === "approved" ? fmtDateTime(t.approvedAt, tz) : s === "in_transit" ? fmtDateTime(t.shippedAt, tz) : fmtDateTime(t.receivedAt, tz)}</p>
            </li>
          ))}
        </ol>
      )}
      {t.status === "rejected" && <Notice tone="error">Rejected: {t.rejectionReason}</Notice>}
      {t.status === "cancelled" && <Notice tone="warn">Cancelled: {t.cancelledReason}</Notice>}
      {t.status === "in_transit" && <Notice tone="info">In transit. {fromName} remains responsible until {toName} confirms receipt.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card title={`Assets (${t.items.length})`}>
            <Table head={["Asset", "Dispatch", "Receipt", "Status"]}>
              {t.items.map((it) => {
                const out = it.handovers.find((h) => h.direction === "outbound");
                const inb = it.handovers.find((h) => h.direction === "inbound");
                const files = (h?: { id: string }) => attachments.filter((a) => a.ownerId === h?.id).map((a) => <a key={a.id} href={`/attachments/${a.id}`} className="mr-1 text-brand-700 hover:underline">{a.filename}</a>);
                const hv = (h?: (typeof it.handovers)[number]) =>
                  h ? (
                    <div className="text-xs">
                      {h.shotReading != null && <p>Counter {fmtNum(h.shotReading, org)}{h.lifetimeShots != null && ` · lifetime ${fmtNum(h.lifetimeShots, org)}`}</p>}
                      <p>{h.conditionOk ? "Condition OK" : <span className="text-amber-700">Condition issues</span>}{h.direction === "outbound" && h.accessories && ` · ${h.accessories}`}{h.direction === "inbound" && h.accessories === "incomplete" && <span className="text-amber-700"> · accessories incomplete</span>}</p>
                      {(h.checklist as unknown as HandoverCheck[]).filter((c) => !c.ok).map((c) => <p key={c.key} className="text-amber-700">✗ {c.label}{c.note && `: ${c.note}`}</p>)}
                      {h.notes && <p className="text-ink-500">{h.notes}</p>}
                      <p>{files(h)}</p>
                    </div>
                  ) : <span className="text-xs text-ink-500">—</span>;
                return (
                  <tr key={it.id}>
                    <Td><Link href={`/assets/${it.assetId}`} className="font-medium hover:text-brand-700">{it.asset.number}</Link><p className="text-xs text-ink-700">{it.asset.name}</p></Td>
                    <Td>{hv(out)}</Td>
                    <Td>{hv(inb)}</Td>
                    <Td><Badge status={it.status === "accepted" || it.status === "resolved" ? "active" : it.status === "disputed" ? "quarantined" : it.status === "shipped" ? "in_transfer" : "pending"}>{it.status}</Badge></Td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          {t.items.some((i) => i.disputes.length) && (
            <Card title="Disputes">
              <ul className="space-y-3">
                {t.items.flatMap((it) => it.disputes.map((d) => (
                  <li key={d.id} className={`rounded-md border p-3 text-sm ${d.status === "open" ? "border-red-200 bg-red-50/50" : "border-gray-200"}`}>
                    <p><span className="font-medium">{it.asset.number}</span> · {d.kind.replace(/_/g, " ")} <Badge status={d.status === "open" ? "quarantined" : "active"}>{d.status}</Badge></p>
                    <p className="mt-1 text-ink-700">{d.detail}</p>
                    {d.status === "resolved" && <p className="mt-1 text-xs text-ink-500">Resolved {fmtDateTime(d.resolvedAt, tz)}: {d.resolution}{d.workOrderId && <> · <Link href={`/maintenance/work-orders/${d.workOrderId}`} className="text-brand-700">work order</Link></>}</p>}
                    {d.status === "open" && canResolve && (
                      <form action={resolveDisputeAction} className="mt-2 space-y-2">
                        <input type="hidden" name="disputeId" value={d.id} />
                        <Textarea name="resolution" rows={2} required placeholder="How was this resolved? (e.g. counter photo confirms trial shots at toolmaker; damage repaired under warranty)" />
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="createWorkOrder" defaultChecked={d.kind === "condition"} /> Create a corrective work order</label>
                        <SubmitButton size="sm">Resolve</SubmitButton>
                      </form>
                    )}
                  </li>
                )))}
              </ul>
            </Card>
          )}

          {canDecide && (
            <Card title="Approve this transfer?">
              <form action={decideTransferAction} className="flex flex-wrap items-end gap-2">
                {hid}
                <Field label="Comment (required to reject)" className="min-w-64 flex-1"><Input name="reason" /></Field>
                <SubmitButton name="decision" value="approve">Approve</SubmitButton>
                <SubmitButton name="decision" value="reject" variant="danger">Reject</SubmitButton>
              </form>
            </Card>
          )}

          {canShip && (
            <Card title={`Dispatch handover · ${t.fromSite.name}`}>
              <form action={shipTransferAction} className="space-y-6" encType="multipart/form-data">
                {hid}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={`Dispatched at (${tz})`}><Input type="datetime-local" name="shippedAt" defaultValue={dateToLocalInput(new Date(), tz)} /></Field>
                  <Field label="Carrier / transporter"><Input name="carrier" /></Field>
                  <Field label="Vehicle number"><Input name="vehicleNumber" placeholder="MH 12 AB 1234" /></Field>
                  <Field label="E-way bill no."><Input name="ewayBillNumber" /></Field>
                  <Field label="LR / tracking no."><Input name="trackingNumber" /></Field>
                  <Field label="Expected arrival"><Input type="date" name="eta" /></Field>
                </div>
                {t.items.map((it) => {
                  const meter = it.asset.meters.find((m) => m.kind === "shots");
                  return (
                    <fieldset key={it.id} className="space-y-3 rounded-lg border border-gray-200 p-4">
                      <legend className="px-1 text-sm font-semibold">{it.asset.number} · {it.asset.name}</legend>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {meter && <Field label="Shot counter now" hint={meter.lastRawValue != null ? `Last reading ${fmtNum(meter.lastRawValue, org)}` : undefined}><Input name={`${it.id}.shots`} inputMode="numeric" required /></Field>}
                        <Field label="Accessories sent" className="sm:col-span-2"><Input name={`${it.id}.accessories`} placeholder="e.g. 2 lifting eyes, hot-runner cable, spare inserts ×4" /></Field>
                      </div>
                      <ChecklistInputs itemId={it.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Notes"><Input name={`${it.id}.notes`} /></Field>
                        <Field label="Photos"><input type="file" name={`${it.id}.photos`} multiple accept="image/*,.pdf" capture="environment" className="block text-sm" /></Field>
                      </div>
                    </fieldset>
                  );
                })}
                <SubmitButton pendingText="Recording…">Record dispatch</SubmitButton>
              </form>
            </Card>
          )}

          {canReceive && (
            <Card title={`Receipt handover · ${t.toSite.name}`}>
              <form action={receiveTransferAction} className="space-y-6" encType="multipart/form-data">
                {hid}
                <Field label={`Received at (${tz})`}><Input type="datetime-local" name="receivedAt" defaultValue={dateToLocalInput(new Date(), tz)} className="max-w-xs" /></Field>
                {t.items.map((it) => {
                  const meter = it.asset.meters.find((m) => m.kind === "shots");
                  const out = it.handovers.find((h) => h.direction === "outbound");
                  return (
                    <fieldset key={it.id} className="space-y-3 rounded-lg border border-gray-200 p-4">
                      <legend className="px-1 text-sm font-semibold">{it.asset.number} · {it.asset.name}</legend>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`${it.id}.tagVerified`} /> The tag on the mold reads <strong>{it.asset.number}</strong></label>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {meter && <Field label="Shot counter on arrival" hint={out?.shotReading != null ? `At dispatch: ${fmtNum(out.shotReading, org)}` : undefined}><Input name={`${it.id}.shots`} inputMode="numeric" required /></Field>}
                        <Field label="Overall condition"><Select name={`${it.id}.conditionOk`} options={{ yes: "Acceptable", no: "Not acceptable" }} /></Field>
                        <Field label={out?.accessories ? `Accessories: ${out.accessories}` : "Accessories"}><Select name={`${it.id}.accessoriesComplete`} options={{ yes: "All received", no: "Something missing" }} /></Field>
                      </div>
                      <ChecklistInputs itemId={it.id} previous={(out?.checklist ?? []) as unknown as HandoverCheck[]} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Notes"><Input name={`${it.id}.notes`} /></Field>
                        <Field label="Photos"><input type="file" name={`${it.id}.photos`} multiple accept="image/*,.pdf" capture="environment" className="block text-sm" /></Field>
                      </div>
                    </fieldset>
                  );
                })}
                <p className="text-xs text-ink-500">Confirming receipt moves custody to {toName}. Differences from the dispatch record (more than {fmtNum(ctx.org.transferShotTolerance, org)} shots, new condition issues or missing accessories) raise a dispute.</p>
                <SubmitButton pendingText="Recording…">Confirm receipt</SubmitButton>
              </form>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card title="Details">
            <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink-500">Requested by</dt><dd className="break-all">{who(t.createdById)}</dd>
              <dt className="text-ink-500">Approved by</dt><dd className="break-all">{t.approvedById ? who(t.approvedById) : t.approvedAt ? "Policy (auto)" : "—"}</dd>
              <dt className="text-ink-500">Needed by</dt><dd>{fmtDate(t.neededBy, tz)}</dd>
              <dt className="text-ink-500">Destination</dt><dd>{t.toSite.name}{t.toLocationDetail && ` · ${t.toLocationDetail}`}</dd>
              {t.carrier && <><dt className="text-ink-500">Carrier</dt><dd>{t.carrier}</dd></>}
              {t.vehicleNumber && <><dt className="text-ink-500">Vehicle</dt><dd>{t.vehicleNumber}</dd></>}
              {t.ewayBillNumber && <><dt className="text-ink-500">E-way bill</dt><dd>{t.ewayBillNumber}</dd></>}
              {t.trackingNumber && <><dt className="text-ink-500">LR / tracking</dt><dd>{t.trackingNumber}</dd></>}
              {t.eta && <><dt className="text-ink-500">ETA</dt><dd>{fmtDate(t.eta, tz)}</dd></>}
              <dt className="text-ink-500">Shipped by</dt><dd className="break-all">{who(t.shippedById)}</dd>
              <dt className="text-ink-500">Received by</dt><dd className="break-all">{who(t.receivedById)}</dd>
            </dl>
            {t.notes && <p className="mt-3 whitespace-pre-wrap border-t border-gray-100 pt-3 text-sm text-ink-700">{t.notes}</p>}
          </Card>
          {["draft", "requested", "approved"].includes(t.status) && ctx.can("transfers", "create") && (
            <Card title="Cancel">
              <form action={cancelTransferAction} className="space-y-2">
                {hid}
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton size="sm" variant="ghost" confirm="Cancel this transfer?">Cancel transfer</SubmitButton>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
