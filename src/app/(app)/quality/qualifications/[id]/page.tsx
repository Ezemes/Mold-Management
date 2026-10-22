import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { currentStage, QUAL_STAGES, QUAL_STATUS, STAGE_NAMES } from "@/lib/quality";
import { label } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Card, FlashFromParams, Input, Notice, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { cancelQualificationAction, failStageAction, passStageAction, startStageAction } from "../../actions";

export const metadata = { title: "Qualification" };

const STAGE_BADGE = { pending: "inactive", in_progress: "pending", passed: "active", failed: "suspended" } as const;
const Q_BADGE = { in_progress: "pending", passed: "active", failed: "suspended", cancelled: "archived" } as const;

export default async function QualificationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const q = await db.qualification.findFirst({ where: { id, orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: true, press: true, stages: true } });
  if (!q) notFound();
  const [users, wos, history] = await Promise.all([
    db.user.findMany({ where: { id: { in: q.stages.flatMap((s) => [s.ownerId, s.approvedById]).filter((x): x is string => !!x) } } }),
    db.workOrder.findMany({ where: { assetId: q.assetId }, select: { id: true, number: true, title: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.auditEvent.findMany({ where: { orgId: ctx.org.id, entityType: "qualification", entityId: q.id }, orderBy: { createdAt: "desc" }, include: { user: true } }),
  ]);
  const name = (uid: string | null) => { const u = users.find((x) => x.id === uid); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const stages = QUAL_STAGES.map((s) => q.stages.find((x) => x.stage === s)!).filter(Boolean);
  const cur = q.status === "in_progress" ? currentStage(q.stages) : null;
  const curRow = stages.find((s) => s.stage === cur);
  const internal = !ctx.isSupplier;
  return (
    <>
      <PageHeader
        back={{ href: "/quality/qualifications", label: "Qualifications" }}
        title={<span className="flex flex-wrap items-center gap-2">{q.number}: {q.asset.number}{q.press && ` on ${q.press.number}`} <Badge status={Q_BADGE[q.status as keyof typeof Q_BADGE]}>{label(QUAL_STATUS, q.status)}</Badge></span>}
        subtitle={<>{q.kind === "requalification" ? "Re-qualification" : "Initial qualification"}{q.reason && `: ${q.reason}`} · <Link href={`/assets/${q.assetId}?tab=quality`} className="text-brand-700 hover:underline">{q.asset.name}</Link></>}
      />
      <FlashFromParams params={sp} />
      {q.status === "passed" && q.press && <Notice tone="success">{q.asset.number} is approved on {q.press.number}. See <Link href="/presses/approved" className="underline">approved pairs</Link>.</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Table head={["Stage", "Owner", "Planned", "Actual", "Result", "Status"]}>
            {stages.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{STAGE_NAMES[s.stage as keyof typeof STAGE_NAMES]}</Td>
                <Td className="text-xs">{name(s.ownerId)}</Td>
                <Td className="text-xs">{fmtDate(s.plannedDate, ctx.org.timezone)}</Td>
                <Td className="text-xs">{fmtDate(s.actualDate, ctx.org.timezone)}</Td>
                <Td className="max-w-xs text-xs">{s.result}{s.workOrderId && <> · <Link href={`/maintenance/work-orders/${s.workOrderId}`} className="text-brand-700 hover:underline">work order</Link></>}{s.approvedById && <p className="text-ink-500">signed off by {name(s.approvedById)}</p>}</Td>
                <Td><Badge status={STAGE_BADGE[s.status as keyof typeof STAGE_BADGE]}>{s.status.replace("_", " ")}</Badge></Td>
              </tr>
            ))}
          </Table>

          {curRow && internal && (
            <Card title={`${STAGE_NAMES[curRow.stage as keyof typeof STAGE_NAMES]}: record the outcome`}>
              {curRow.status === "pending" && ctx.can("quality", "edit") && (
                <form action={startStageAction} className="mb-4">
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="stage" value={curRow.stage} />
                  <SubmitButton variant="secondary">Start {curRow.stage}</SubmitButton>
                </form>
              )}
              {ctx.can("quality", "approve") ? (
                <form action={passStageAction} className="space-y-3">
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="stage" value={curRow.stage} />
                  <Textarea name="result" placeholder={curRow.stage === "PQ" ? "e.g. 3 × 8 h runs, Cpk 1.45 on critical dims, cycle 44 s" : "What was checked and the outcome"} aria-label="Result" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input name="actualDate" placeholder="Actual date DD-MM-YYYY (blank = today)" aria-label="Actual date" />
                    <Select name="workOrderId" placeholder="Link a work order (optional)" options={wos.map((w) => [w.id, `${w.number} ${w.title}`] as [string, string])} aria-label="Work order" />
                  </div>
                  <div className="flex gap-2">
                    <SubmitButton confirm={`Sign off ${curRow.stage} as passed?`}>Pass {curRow.stage}</SubmitButton>
                    <SubmitButton formAction={failStageAction} variant="danger" confirm={`Record ${curRow.stage} as failed? This closes the qualification.`}>Fail {curRow.stage}</SubmitButton>
                  </div>
                </form>
              ) : <p className="text-sm text-ink-500">A quality approver signs off each stage.</p>}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {q.status === "in_progress" && internal && ctx.can("quality", "approve") && (
            <Card title="Cancel qualification">
              <form action={cancelQualificationAction} className="space-y-2">
                <input type="hidden" name="id" value={q.id} />
                <Input name="reason" placeholder="Reason" aria-label="Cancel reason" />
                <SubmitButton size="sm" variant="danger" confirm="Cancel this qualification?">Cancel</SubmitButton>
              </form>
            </Card>
          )}
          <Card title="History">
            <ul className="space-y-2 text-xs">
              {history.map((h) => <li key={h.id}><span className="font-medium">{h.entityLabel?.split(" ")[1] ?? ""} {h.action.replace(/_/g, " ")}</span> · {h.user ? `${h.user.firstName} ${h.user.lastName}` : "System"} · {fmtDateTime(h.createdAt, ctx.org.timezone)}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
