import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { OPEN_WO, PRIORITY_COLOR, WO_BADGE, WO_PRIORITY, WO_STATUS, WO_TYPES, woCost, workOrderScope, type TaskResult } from "@/lib/maintenance";
import { label } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { Badge, Card, cx, Field, FlashFromParams, Input, Notice, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { addLaborAction, addPartAction, issueStockAction, assignWorkOrderAction, cancelWorkOrderAction, completeWorkOrderAction, removeCostLineAction, saveWorkOrderAction, workOrderStatusAction } from "../../actions";
import { assigneeOptions } from "../assignees";

const RESULT_COLOR = { pass: "green", fail: "red", na: "gray" } as const;

function TaskSpec({ t }: { t: TaskResult }) {
  return (
    <>
      <p className={cx(t.required ? "font-medium" : "")}>{t.text}{!t.required && <span className="ml-1 text-xs font-normal text-ink-500">(optional)</span>}</p>
      {t.type === "measure" && (
        <p className="text-xs text-ink-500">
          Measure{t.unit ? ` in ${t.unit}` : ""}{t.min != null && t.max != null ? `, allowed ${t.min}–${t.max}` : ""}
        </p>
      )}
      {t.type === "photo" && <p className="text-xs text-ink-500">Attach a photo below</p>}
    </>
  );
}

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "view"]);
  const { org } = ctx;
  const wo = await db.workOrder.findFirst({
    where: { AND: [workOrderScope(ctx), { id }] },
    include: {
      asset: { include: { meters: true, site: true } },
      assignedUser: true,
      assignedPartner: true,
      plan: { include: { template: true } },
      template: true,
      labor: { orderBy: { createdAt: "asc" } },
      parts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!wo) notFound();
  const [attachments, history, assignees, completedBy, followUps, source] = await Promise.all([
    db.attachment.findMany({ where: { ownerType: "work_order", ownerId: wo.id }, orderBy: { createdAt: "asc" } }),
    db.auditEvent.findMany({ where: { orgId: org.id, entityType: "work_order", entityId: wo.id }, orderBy: { createdAt: "desc" }, include: { user: true } }),
    !ctx.isSupplier && ctx.can("maintenance", "create") && OPEN_WO.includes(wo.status) ? assigneeOptions(org.id) : Promise.resolve([] as [string, string][]),
    wo.completedById ? db.user.findUnique({ where: { id: wo.completedById } }) : Promise.resolve(null),
    db.workOrder.findMany({ where: { orgId: org.id, sourceId: wo.id, source: "checklist_failure" }, select: { id: true, number: true, status: true } }),
    wo.source === "checklist_failure" ? db.workOrder.findFirst({ where: { id: wo.sourceId, orgId: org.id }, select: { id: true, number: true } })
      : wo.source === "dispute" ? db.dispute.findFirst({ where: { id: wo.sourceId }, select: { item: { select: { transfer: { select: { id: true, number: true } } } } } }).then((d) => d && { id: d.item.transfer.id, number: d.item.transfer.number, transfer: true })
      : Promise.resolve(null),
  ]);
  const open = OPEN_WO.includes(wo.status);
  const downtime = ctx.can("downtime") ? await db.downtimeEvent.findMany({ where: { workOrderId: wo.id }, select: { id: true, number: true, endedAt: true }, orderBy: { startedAt: "asc" } }) : [];
  const stock = open && !ctx.isSupplier && ctx.can("inventory", "edit")
    ? await db.stock.findMany({ where: { siteId: wo.asset.siteId, quantity: { gt: 0 }, part: { active: true } }, include: { part: { include: { assets: { where: { assetId: wo.assetId } } } } }, orderBy: { part: { number: "asc" } } })
    : [];
  // Parts listed for this asset come first.
  const stockParts = stock
    .sort((a, b) => b.part.assets.length - a.part.assets.length)
    .map((s) => [s.partId, `${s.part.assets.length ? "★ " : ""}${s.part.number} ${s.part.name} (${s.quantity.toLocaleString("en-IN")} ${s.part.unit} in stock)`] as [string, string]);
  const canWork = ctx.can("maintenance", "edit") && (!ctx.isSupplier || (!!ctx.scope.partnerId && (wo.assignedPartnerId === ctx.scope.partnerId || wo.asset.custodianPartnerId === ctx.scope.partnerId)));
  const editable = open && canWork;
  const tasks = (wo.checklist ?? []) as unknown as TaskResult[];
  const lifetime = wo.asset.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null;
  const cost = woCost(wo);
  const overdue = open && wo.dueDate && wo.dueDate < new Date();
  const money = (n: number) => fmtMoney(n, org);
  const assigned = wo.assignedUser ? `${wo.assignedUser.firstName} ${wo.assignedUser.lastName}` : wo.assignedPartner?.name ?? "Unassigned";
  const failed = tasks.filter((t) => t.result === "fail");

  return (
    <>
      <PageHeader
        back={{ href: "/maintenance", label: "Maintenance" }}
        title={<span className="flex flex-wrap items-center gap-2">{wo.number}: {wo.title} <Badge status={WO_BADGE[wo.status]}>{label(WO_STATUS, wo.status)}</Badge></span>}
        subtitle={<>{label(WO_TYPES, wo.type)} on <Link href={`/assets/${wo.asset.id}?tab=maintenance`} className="text-brand-700 hover:underline">{wo.asset.number} {wo.asset.name}</Link> at {wo.asset.site.name}</>}
        actions={
          editable && (
            <>
              {wo.status === "open" && (
                <form action={workOrderStatusAction}>
                  <input type="hidden" name="id" value={wo.id} />
                  <input type="hidden" name="step" value="start" />
                  <SubmitButton>Start work</SubmitButton>
                </form>
              )}
              {wo.status === "on_hold" && (
                <form action={workOrderStatusAction}>
                  <input type="hidden" name="id" value={wo.id} />
                  <input type="hidden" name="step" value="resume" />
                  <SubmitButton>Resume</SubmitButton>
                </form>
              )}
            </>
          )
        }
      />
      <FlashFromParams params={sp} />
      {wo.clearsQuarantine && open && <Notice tone="warn">{wo.asset.number} is quarantined. Completing this work order with every required check passed releases it back to active.</Notice>}
      {overdue && <Notice tone="warn">Overdue since {fmtDate(wo.dueDate, org.timezone)}.</Notice>}
      {wo.status === "cancelled" && <Notice tone="info">Cancelled: {wo.cancelReason}</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {wo.description && (
            <Card title="Description">
              <p className="whitespace-pre-wrap text-sm">{wo.description}</p>
            </Card>
          )}

          {editable ? (
            <form action={saveWorkOrderAction} className="space-y-6">
              <input type="hidden" name="id" value={wo.id} />
              <Card title={`Checklist${tasks.length ? ` (${tasks.length})` : ""}`}>
                {tasks.length === 0 ? (
                  <p className="text-sm text-ink-500">No checklist on this work order. Record what was done under Findings.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {tasks.map((t) => (
                      <div key={t.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                        <div className="min-w-0 text-sm">
                          <TaskSpec t={t} />
                          <input name={`${t.id}.note`} defaultValue={t.note ?? ""} placeholder="Note" aria-label={`Note for ${t.text}`} className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                        </div>
                        <div className="flex items-start gap-2">
                          {t.type === "measure" && (
                            <input name={`${t.id}.value`} defaultValue={t.value ?? ""} inputMode="decimal" placeholder={t.unit ?? "value"} aria-label={`Value for ${t.text}`} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
                          )}
                          <select name={`${t.id}.result`} defaultValue={t.result ?? ""} aria-label={`Result for ${t.text}`} className="rounded border border-gray-300 px-2 py-1 text-sm">
                            <option value="">{t.type === "measure" ? "Auto" : "—"}</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                            <option value="na">N/A</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {wo.passPct != null && <p className="mt-3 text-xs text-ink-500">Last saved: {Math.round(wo.passPct)}% of scored checks passed.</p>}
              </Card>

              <Card title="Findings">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Root cause" name="rootCause">
                    <Textarea name="rootCause" defaultValue={wo.rootCause} />
                  </Field>
                  <Field label="Resolution / work done" name="resolution" hint={wo.type === "corrective" ? "Required to close a corrective work order." : undefined}>
                    <Textarea name="resolution" defaultValue={wo.resolution} />
                  </Field>
                  <Field label={`External cost (${org.currency})`} name="externalCost" hint="Vendor invoices, outside machining etc.">
                    <Input name="externalCost" inputMode="decimal" defaultValue={Number(wo.externalCost) || ""} />
                  </Field>
                  <Field label="Photos / files" name="photos" hint="Up to 10 files; images or PDF.">
                    <input type="file" name="photos" multiple accept="image/*,application/pdf" className="block w-full text-sm" />
                  </Field>
                </div>
                <div className="mt-4">
                  <SubmitButton variant="secondary" pendingText="Saving…">Save progress</SubmitButton>
                </div>
              </Card>

              <Card title="Complete and sign off">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Signed by (full name)" name="signedByName">
                    <Input name="signedByName" defaultValue={`${ctx.user.firstName} ${ctx.user.lastName}`.trim()} />
                  </Field>
                  {lifetime != null && (
                    <Field label="Lifetime shots at completion" name="shotsAtCompletion" hint={`Current count ${fmtNum(lifetime, org)}. The plan restarts from here.`}>
                      <Input name="shotsAtCompletion" inputMode="numeric" defaultValue={lifetime} />
                    </Field>
                  )}
                </div>
                {tasks.length > 0 && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="followUp" defaultChecked /> Raise a corrective work order for any failed checks
                  </label>
                )}
                <div className="mt-4">
                  <SubmitButton formAction={completeWorkOrderAction} pendingText="Completing…" confirm="Complete and sign off this work order?">Complete work order</SubmitButton>
                </div>
              </Card>
            </form>
          ) : (
            <>
              {tasks.length > 0 && (
                <Card title="Checklist" actions={wo.passPct != null && <span className="text-xs text-ink-500">{Math.round(wo.passPct)}% passed</span>}>
                  <div className="divide-y divide-gray-100">
                    {tasks.map((t) => (
                      <div key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <TaskSpec t={t} />
                          {t.note && <p className="text-xs text-ink-700">{t.note}</p>}
                        </div>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {t.value != null && <span className="text-xs">{t.value}{t.unit ? ` ${t.unit}` : ""}</span>}
                          {t.result ? <Badge color={RESULT_COLOR[t.result]}>{t.result === "na" ? "N/A" : t.result}</Badge> : <span className="text-xs text-ink-500">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {(wo.rootCause || wo.resolution) && (
                <Card title="Findings">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-ink-500">Root cause</dt><dd className="whitespace-pre-wrap">{wo.rootCause || "—"}</dd></div>
                    <div><dt className="text-xs text-ink-500">Resolution</dt><dd className="whitespace-pre-wrap">{wo.resolution || "—"}</dd></div>
                  </dl>
                </Card>
              )}
              {wo.status === "completed" && (
                <Card title="Sign-off">
                  <p className="text-sm">
                    Signed by <strong>{wo.signedByName}</strong> on {fmtDateTime(wo.signedAt, org.timezone)}
                    {completedBy && <span className="text-ink-500"> (account: {completedBy.email})</span>}
                    {wo.shotsAtCompletion != null && <> at {fmtNum(wo.shotsAtCompletion, org)} lifetime shots</>}.
                  </p>
                  {failed.length > 0 && <p className="mt-2 text-sm text-red-700">{failed.length} check(s) failed.</p>}
                </Card>
              )}
            </>
          )}

          <Card title="Labour and parts" actions={<span className="text-sm font-medium">{money(cost.total)}</span>}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Labour · {fmtNum(cost.hours, org, 1)} h · {money(cost.labor)}</h3>
            <Table head={["Who", "Hours", "Rate", "Amount", "Note", ""]} empty="No labour logged.">
              {wo.labor.map((l) => (
                <tr key={l.id}>
                  <Td>{l.workerName}</Td>
                  <Td>{fmtNum(l.hours, org, 1)}</Td>
                  <Td>{money(Number(l.rate))}</Td>
                  <Td>{money(l.hours * Number(l.rate))}</Td>
                  <Td className="text-xs">{l.note}</Td>
                  <Td>
                    {editable && (
                      <form action={removeCostLineAction}>
                        <input type="hidden" name="id" value={wo.id} />
                        <input type="hidden" name="kind" value="labor" />
                        <input type="hidden" name="lineId" value={l.id} />
                        <SubmitButton size="sm" variant="ghost">Remove</SubmitButton>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {editable && (
              <form action={addLaborAction} className="mt-3 grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="id" value={wo.id} />
                <Input name="workerName" placeholder="Name (blank = you)" aria-label="Worker name" />
                <Input name="hours" inputMode="decimal" placeholder="Hours" aria-label="Hours" required />
                <Input name="rate" inputMode="decimal" placeholder={`Rate ${org.currency}/h`} aria-label="Hourly rate" />
                <Input name="note" placeholder="Note" aria-label="Labour note" />
                <SubmitButton size="sm" variant="secondary">Add labour</SubmitButton>
              </form>
            )}
            <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">Parts · {money(cost.parts)}</h3>
            <Table head={["Part", "Description", "Qty", "Unit cost", "Amount", ""]} empty="No parts used.">
              {wo.parts.map((p) => (
                <tr key={p.id}>
                  <Td className="text-xs">{p.partNumber || "—"}</Td>
                  <Td>{p.description}</Td>
                  <Td>{fmtNum(p.quantity, org, 2)}</Td>
                  <Td>{money(Number(p.unitCost))}</Td>
                  <Td>{money(p.quantity * Number(p.unitCost))}</Td>
                  <Td>
                    {editable && (
                      <form action={removeCostLineAction}>
                        <input type="hidden" name="id" value={wo.id} />
                        <input type="hidden" name="kind" value="part" />
                        <input type="hidden" name="lineId" value={p.id} />
                        <SubmitButton size="sm" variant="ghost">Remove</SubmitButton>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {editable && (
              <form action={addPartAction} className="mt-3 grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="id" value={wo.id} />
                <Input name="partNumber" placeholder="Part no." aria-label="Part number" />
                <Input name="description" placeholder="Description" aria-label="Part description" required />
                <Input name="quantity" inputMode="decimal" placeholder="Qty" aria-label="Quantity" required />
                <Input name="unitCost" inputMode="decimal" placeholder={`Unit cost ${org.currency}`} aria-label="Unit cost" />
                <SubmitButton size="sm" variant="secondary">Add part</SubmitButton>
              </form>
            )}
            {editable && stockParts.length > 0 && (
              <form action={issueStockAction} className="mt-3 grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="id" value={wo.id} />
                <Select name="partId" options={stockParts} aria-label="Part from stock" className="sm:col-span-3" />
                <Input name="quantity" inputMode="decimal" placeholder="Qty" aria-label="Quantity from stock" required />
                <SubmitButton size="sm" variant="secondary">Issue from stock</SubmitButton>
              </form>
            )}
            {cost.external > 0 && <p className="mt-4 text-sm">External cost: {money(cost.external)}</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Priority</dt><dd><Badge color={PRIORITY_COLOR[wo.priority as keyof typeof PRIORITY_COLOR]}>{label(WO_PRIORITY, wo.priority)}</Badge></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Assigned to</dt><dd className="text-right">{assigned}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Due</dt><dd className={cx(overdue && "font-medium text-amber-700")}>{fmtDate(wo.dueDate, org.timezone)}</dd></div>
              {wo.dueAtShots != null && <div className="flex justify-between gap-3"><dt className="text-ink-500">Due at</dt><dd>{fmtNum(wo.dueAtShots, org)} shots</dd></div>}
              {lifetime != null && <div className="flex justify-between gap-3"><dt className="text-ink-500">Shots now</dt><dd>{fmtNum(lifetime, org)}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Raised</dt><dd>{fmtDate(wo.createdAt, org.timezone)}</dd></div>
              {wo.startedAt && <div className="flex justify-between gap-3"><dt className="text-ink-500">Started</dt><dd>{fmtDateTime(wo.startedAt, org.timezone)}</dd></div>}
              {wo.completedAt && <div className="flex justify-between gap-3"><dt className="text-ink-500">Completed</dt><dd>{fmtDateTime(wo.completedAt, org.timezone)}</dd></div>}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Source</dt>
                <dd className="text-right">
                  {wo.source === "trigger" && wo.plan ? <>Plan: {wo.plan.template.name} (every {fmtNum(wo.plan.interval, org)} {wo.plan.triggerType})</>
                    : source && "transfer" in source ? <Link href={`/transfers/${source.id}`} className="text-brand-700 hover:underline">Dispute on {source.number}</Link>
                    : source ? <Link href={`/maintenance/work-orders/${source.id}`} className="text-brand-700 hover:underline">Failed checks on {source.number}</Link>
                    : wo.source === "downtime" ? "Downtime report"
                    : wo.source.replace("_", " ")}
                </dd>
              </div>
              {wo.template && <div className="flex justify-between gap-3"><dt className="text-ink-500">Template</dt><dd>{wo.template.name}</dd></div>}
              {downtime.length > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-500">Downtime</dt><dd className="text-right">{downtime.map((d) => <Link key={d.id} href={`/downtime/${d.id}`} className="ml-2 text-brand-700 hover:underline">{d.number}{!d.endedAt && " (mold down)"}</Link>)}</dd></div>}
            </dl>
            {followUps.length > 0 && (
              <p className="mt-3 text-sm">
                Follow-up: {followUps.map((f) => <Link key={f.id} href={`/maintenance/work-orders/${f.id}`} className="mr-2 text-brand-700 hover:underline">{f.number}</Link>)}
              </p>
            )}
          </Card>

          {assignees.length > 0 && (
            <Card title="Assign">
              <form action={assignWorkOrderAction} className="space-y-3">
                <input type="hidden" name="id" value={wo.id} />
                <Field label="Assigned to" name="assignee">
                  <Select name="assignee" placeholder="Unassigned" options={assignees} defaultValue={wo.assignedUserId ? `u:${wo.assignedUserId}` : wo.assignedPartnerId ? `p:${wo.assignedPartnerId}` : ""} />
                </Field>
                <Field label="Priority" name="priority">
                  <Select name="priority" options={WO_PRIORITY} defaultValue={wo.priority} />
                </Field>
                <Field label="Due date" name="dueDate" hint="DD-MM-YYYY. Blank keeps the current date.">
                  <Input name="dueDate" placeholder="DD-MM-YYYY" />
                </Field>
                <SubmitButton size="sm" variant="secondary">Update</SubmitButton>
              </form>
            </Card>
          )}

          {editable && wo.status === "in_progress" && (
            <Card title="Put on hold">
              <form action={workOrderStatusAction} className="space-y-2">
                <input type="hidden" name="id" value={wo.id} />
                <input type="hidden" name="step" value="hold" />
                <Input name="reason" placeholder="e.g. waiting for ejector pins" aria-label="Hold reason" />
                <SubmitButton size="sm" variant="secondary">Put on hold</SubmitButton>
              </form>
            </Card>
          )}

          <Card title={`Attachments (${attachments.length})`}>
            {attachments.length === 0 ? <p className="text-sm text-ink-500">None yet.</p> : (
              <ul className="space-y-1 text-sm">
                {attachments.map((a) => <li key={a.id}><a href={`/attachments/${a.id}`} className="text-brand-700 hover:underline">{a.filename}</a> <span className="text-xs text-ink-500">{fmtDate(a.createdAt, org.timezone)}</span></li>)}
              </ul>
            )}
          </Card>

          {open && !ctx.isSupplier && ctx.can("maintenance", "create") && !(wo.clearsQuarantine && wo.asset.status === "quarantined") && (
            <Card title="Cancel work order">
              <form action={cancelWorkOrderAction} className="space-y-2">
                <input type="hidden" name="id" value={wo.id} />
                <Input name="reason" placeholder="Reason" aria-label="Cancel reason" />
                <SubmitButton size="sm" variant="danger" confirm="Cancel this work order?">Cancel work order</SubmitButton>
              </form>
            </Card>
          )}

          <Card title="History">
            <ul className="space-y-2 text-xs">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.action.replace(/_/g, " ")}</span> · {h.user ? `${h.user.firstName} ${h.user.lastName}` : "System"} · {fmtDateTime(h.createdAt, org.timezone)}
                  {h.reason && <p className="text-ink-500">{h.reason}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
