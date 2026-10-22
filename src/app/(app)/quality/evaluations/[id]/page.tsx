import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { scoreBand } from "@/lib/quality";
import { assessmentOutcome, QUESTIONS, RATINGS, ratingWord, type Answers, type ComponentResult } from "@/lib/inspection";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { Badge, Card, cx, FlashFromParams, Input, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { approveEvaluationAction, rejectEvaluationAction } from "../../actions";

export const metadata = { title: "Condition assessment" };

const BAND = { good: "green", watch: "amber", poor: "red", none: "gray" } as const;
const RATING_COLOR = (r: number | null | undefined) => (r == null ? "gray" : (RATINGS[r as 1]?.color ?? "gray")) as "green" | "amber" | "red" | "gray";

export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const ev = await db.conditionEvaluation.findFirst({ where: { id, orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: { include: { assetType: true } } } });
  if (!ev) notFound();
  const [users, files, wo, previous, template] = await Promise.all([
    db.user.findMany({ where: { id: { in: [ev.evaluatedById, ev.decidedById].filter((x): x is string => !!x) } } }),
    db.attachment.findMany({ where: { ownerType: "evaluation", ownerId: ev.id }, orderBy: { createdAt: "asc" } }),
    ev.workOrderId ? db.workOrder.findUnique({ where: { id: ev.workOrderId }, select: { id: true, number: true } }) : null,
    db.conditionEvaluation.findFirst({ where: { assetId: ev.assetId, status: "approved", evaluatedAt: { lt: ev.evaluatedAt } }, orderBy: { evaluatedAt: "desc" } }),
    ev.templateId ? db.inspectionTemplate.findUnique({ where: { id: ev.templateId }, select: { name: true } }) : null,
  ]);
  const name = (uid: string | null) => { const u = users.find((x) => x.id === uid); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const t = ev.asset.assetType;
  const results = ev.scores as unknown as (ComponentResult & { photoIds?: string[] })[];
  const ans = ev.answers as unknown as Partial<Answers>;
  const prev = Object.fromEntries(((previous?.scores ?? []) as unknown as ComponentResult[]).map((c) => [c.key, c.score ?? null]));
  const photosOf = (ids: string[] = []) => files.filter((f) => ids.includes(f.id));
  const linked = new Set(results.flatMap((c) => c.photoIds ?? []));
  const videos = files.filter((f) => f.mimeType.startsWith("video/"));
  const others = files.filter((f) => !linked.has(f.id) && !f.mimeType.startsWith("video/"));
  const outcome = assessmentOutcome(results, { qualityIssues: ans.qualityIssues ?? null, operationalIssues: ans.operationalIssues ?? null, spareParts: ans.spareParts ?? null, supplyRisk: ans.supplyRisk ?? null }, ev.score, t.evalThreshold);
  const canDecide = ev.status === "submitted" && ctx.can("quality", "approve") && !ctx.isSupplier;
  const yn = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Yes" : "No");
  const d = ans.dynamic;
  return (
    <>
      <PageHeader
        back={{ href: "/quality", label: "Quality" }}
        title={<span className="flex flex-wrap items-center gap-2">Assessment of {ev.asset.number} <Badge color={BAND[scoreBand(ev.score, t.evalThreshold)]}>{ev.score.toFixed(2)} / 5</Badge> <Badge status={ev.status === "approved" ? "active" : ev.status === "rejected" ? "suspended" : "pending"}>{ev.status}</Badge></span>}
        subtitle={<>By {name(ev.evaluatedById)} on {fmtDateTime(ev.evaluatedAt, ctx.org.timezone)} · {ev.mode === "machine" ? "on the machine" : "on the bench"}{template && ` · ${template.name} template`} · <Link href={`/assets/${ev.assetId}?tab=quality`} className="text-brand-700 hover:underline">{ev.asset.name}</Link></>}
      />
      <FlashFromParams params={sp} />
      {outcome.stopTool && ev.status === "submitted" && <Notice tone="error">Unacceptable rating: the tool should not run until corrected. Approving quarantines {ev.asset.number} and raises a release work order.</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {d && (
            <Card title="At the time of assessment">
              <dl className="grid gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-ink-500">Cavities running</dt><dd>{d.cavitiesRunning ?? "—"} of {d.cavitiesTotal ?? "—"}</dd></div>
                <div><dt className="text-xs text-ink-500">Last run date</dt><dd>{d.lastRunDate ? fmtDate(new Date(d.lastRunDate), ctx.org.timezone) : "—"}</dd></div>
                <div><dt className="text-xs text-ink-500">Total shots</dt><dd>{fmtNum(d.totalShots ?? ev.shots, ctx.org)}</dd></div>
                <div><dt className="text-xs text-ink-500">Annual volume</dt><dd>{fmtNum(d.annualVolume, ctx.org)}</dd></div>
              </dl>
            </Card>
          )}
          <Card title={`Components (${results.length})`}>
            <div className="divide-y divide-gray-100">
              {results.map((c) => (
                <div key={c.key} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{c.label}</p>
                    <span className="flex items-center gap-2 text-xs">
                      {c.key in prev && <span className="text-ink-500">was {ratingWord(prev[c.key])}</span>}
                      <Badge color={RATING_COLOR(c.score)}>{c.score == null ? "N/A" : `${c.score} · ${ratingWord(c.score)}`}</Badge>
                    </span>
                  </div>
                  {(c.checkResults ?? []).length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {c.checkResults.map((k, i) => <li key={i} className={cx(k.ok === false && "font-medium text-red-700")}>{k.ok === false ? "✗ NO" : k.ok ? "✓ YES" : "—"} · {k.text}</li>)}
                    </ul>
                  )}
                  {c.note && <p className="mt-1 text-sm text-ink-700">{c.note}</p>}
                  {photosOf(c.photoIds).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {photosOf(c.photoIds).map((f) => <a key={f.id} href={`/attachments/${f.id}`} target="_blank" rel="noreferrer" className="block"><img src={`/attachments/${f.id}`} alt={`${c.label} photo`} className="h-20 w-20 rounded object-cover ring-1 ring-gray-200" /></a>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          {ans.overallCondition !== undefined && (
            <Card title="Issues and comments">
              <dl className="space-y-3 text-sm">
                <div><dt className="text-xs text-ink-500">{QUESTIONS.qualityIssues}</dt><dd>{yn(ans.qualityIssues)}{ans.qualityNote && ` — ${ans.qualityNote}`}</dd></div>
                <div><dt className="text-xs text-ink-500">{QUESTIONS.operationalIssues}</dt><dd>{yn(ans.operationalIssues)}{ans.operationalNote && ` — ${ans.operationalNote}`}</dd></div>
                <div><dt className="text-xs text-ink-500">{QUESTIONS.sparePartsNeeded}</dt><dd>{ans.spareParts ?? "—"}{ans.sparePartsNote && ` — ${ans.sparePartsNote}`}</dd></div>
                <div><dt className="text-xs text-ink-500">{QUESTIONS.supplyRisk}</dt><dd>{yn(ans.supplyRisk)}{ans.supplyRiskNote && ` — ${ans.supplyRiskNote}`}</dd></div>
                <div><dt className="text-xs text-ink-500">{QUESTIONS.overallCondition}</dt><dd className="whitespace-pre-wrap">{ans.overallCondition || "—"}</dd></div>
                <div><dt className="text-xs text-ink-500">{QUESTIONS.recommendations}</dt><dd className="whitespace-pre-wrap">{ans.recommendations || "—"}</dd></div>
              </dl>
            </Card>
          )}
          {ans.overallCondition === undefined && ev.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{ev.notes}</p></Card>}
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
            {outcome.reasons.length > 0 && <ul className="mt-3 space-y-0.5 text-xs text-red-700">{outcome.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
            {ev.rejectReason && <p className="mt-3 text-sm text-red-700">{ev.rejectReason}</p>}
            {canDecide && (
              <form action={approveEvaluationAction} className="mt-4 space-y-2">
                <input type="hidden" name="id" value={ev.id} />
                {outcome.workOrderRequired && <p className="text-xs text-amber-700">{outcome.stopTool ? "Approving quarantines the mold and raises a release work order." : "Approving raises a corrective work order."}</p>}
                <Input name="reason" placeholder="Reason (needed to reject)" aria-label="Reason" />
                <div className="flex gap-2">
                  <SubmitButton>Approve</SubmitButton>
                  <SubmitButton formAction={rejectEvaluationAction} variant="danger">Reject</SubmitButton>
                </div>
              </form>
            )}
          </Card>
          {videos.length > 0 && (
            <Card title="Video">
              {videos.map((v) => <video key={v.id} src={`/attachments/${v.id}`} controls className="w-full rounded" />)}
            </Card>
          )}
          <Card title={`Other files (${others.length})`}>
            {others.length === 0 ? <p className="text-sm text-ink-500">None.</p> : <ul className="space-y-1 text-sm">{others.map((f) => <li key={f.id}><a href={`/attachments/${f.id}`} className="text-brand-700 hover:underline">{f.filename}</a></li>)}</ul>}
          </Card>
        </div>
      </div>
    </>
  );
}
