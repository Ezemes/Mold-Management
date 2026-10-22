import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { scoreBand, type Score } from "@/lib/quality";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { Badge, Card, FlashFromParams, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { approveEvaluationAction, rejectEvaluationAction } from "../../actions";

export const metadata = { title: "Condition evaluation" };

const BAND = { good: "green", watch: "amber", poor: "red", none: "gray" } as const;

export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const ev = await db.conditionEvaluation.findFirst({ where: { id, orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: { include: { assetType: true } } } });
  if (!ev) notFound();
  const [users, files, wo, previous] = await Promise.all([
    db.user.findMany({ where: { id: { in: [ev.evaluatedById, ev.decidedById].filter((x): x is string => !!x) } } }),
    db.attachment.findMany({ where: { ownerType: "evaluation", ownerId: ev.id } }),
    ev.workOrderId ? db.workOrder.findUnique({ where: { id: ev.workOrderId }, select: { id: true, number: true } }) : null,
    db.conditionEvaluation.findFirst({ where: { assetId: ev.assetId, status: "approved", evaluatedAt: { lt: ev.evaluatedAt } }, orderBy: { evaluatedAt: "desc" } }),
  ]);
  const name = (uid: string | null) => { const u = users.find((x) => x.id === uid); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const t = ev.asset.assetType;
  const scores = ev.scores as unknown as Score[];
  const canDecide = ev.status === "submitted" && ctx.can("quality", "approve") && !ctx.isSupplier;
  return (
    <>
      <PageHeader
        back={{ href: "/quality", label: "Quality" }}
        title={<span className="flex flex-wrap items-center gap-2">Evaluation of {ev.asset.number} <Badge color={BAND[scoreBand(ev.score, t.evalThreshold)]}>{ev.score.toFixed(2)} / 5</Badge> <Badge status={ev.status === "approved" ? "active" : ev.status === "rejected" ? "suspended" : "pending"}>{ev.status}</Badge></span>}
        subtitle={<>By {name(ev.evaluatedById)} on {fmtDateTime(ev.evaluatedAt, ctx.org.timezone)}{ev.shots != null && ` at ${fmtNum(ev.shots, ctx.org)} shots`} · <Link href={`/assets/${ev.assetId}?tab=quality`} className="text-brand-700 hover:underline">{ev.asset.name}</Link></>}
      />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Table head={["Criterion", "Weight", "Score", "Note"]}>
            {scores.map((s) => (
              <tr key={s.key}>
                <Td>{s.label}</Td>
                <Td className="text-xs">{s.weight}</Td>
                <Td>{s.score == null ? <span className="text-xs text-ink-500">N/A</span> : <Badge color={s.score <= 2 ? "red" : s.score === 3 ? "amber" : "green"}>{s.score}</Badge>}</Td>
                <Td className="text-xs">{s.note}</Td>
              </tr>
            ))}
          </Table>
          {ev.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{ev.notes}</p></Card>}
        </div>
        <div className="space-y-6">
          <Card title="Result">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">Weighted score</dt><dd>{ev.score.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Threshold</dt><dd>{t.evalThreshold}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Previous approved</dt><dd>{previous ? `${previous.score.toFixed(2)} (${ev.score >= previous.score ? "+" : ""}${(ev.score - previous.score).toFixed(2)})` : "—"}</dd></div>
              {ev.decidedAt && <div className="flex justify-between"><dt className="text-ink-500">{ev.status === "approved" ? "Approved" : "Rejected"}</dt><dd>{name(ev.decidedById)}</dd></div>}
              {wo && <div className="flex justify-between"><dt className="text-ink-500">Work order</dt><dd><Link href={`/maintenance/work-orders/${wo.id}`} className="text-brand-700 hover:underline">{wo.number}</Link></dd></div>}
            </dl>
            {ev.rejectReason && <p className="mt-3 text-sm text-red-700">{ev.rejectReason}</p>}
            {canDecide && (
              <form action={approveEvaluationAction} className="mt-4 space-y-2">
                <input type="hidden" name="id" value={ev.id} />
                {ev.score < t.evalThreshold && <p className="text-xs text-amber-700">Below the threshold: approving raises a corrective work order.</p>}
                <Input name="reason" placeholder="Reason (needed to reject)" aria-label="Reason" />
                <div className="flex gap-2">
                  <SubmitButton>Approve</SubmitButton>
                  <SubmitButton formAction={rejectEvaluationAction} variant="danger">Reject</SubmitButton>
                </div>
              </form>
            )}
          </Card>
          <Card title={`Photos (${files.length})`}>
            {files.length === 0 ? <p className="text-sm text-ink-500">None.</p> : <ul className="space-y-1 text-sm">{files.map((f) => <li key={f.id}><a href={`/attachments/${f.id}`} className="text-brand-700 hover:underline">{f.filename}</a></li>)}</ul>}
          </Card>
        </div>
      </div>
    </>
  );
}
