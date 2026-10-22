import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { scoreBand } from "@/lib/quality";
import { fmtDate } from "@/lib/format";
import { Badge, cx, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { QUALITY_TABS } from "@/lib/tabs";

export const metadata = { title: "Quality" };

const VIEWS = [["pending", "Awaiting approval"], ["due", "Due for evaluation"], ["recent", "Recent"]] as const;
const BAND = { good: "green", watch: "amber", poor: "red", none: "gray" } as const;
const EV_STATUS = { submitted: "pending", approved: "active", rejected: "suspended" } as const;

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? "pending";
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const [evaluations, due, pendingCount] = await Promise.all([
    view === "due" ? Promise.resolve([]) : db.conditionEvaluation.findMany({
      where: { orgId: ctx.org.id, asset: assetScope(ctx), ...(view === "pending" ? { status: "submitted" } : {}) },
      include: { asset: { include: { assetType: true } } },
      orderBy: { evaluatedAt: "desc" },
      take: 200,
    }),
    view === "due" ? db.asset.findMany({
      where: { AND: [assetScope(ctx), { assetType: { kind: "mold" }, parentId: null, status: { notIn: ["retired", "scrapped"] } }, { OR: [{ nextEvaluationDate: null }, { nextEvaluationDate: { lte: soon } }] }] },
      include: { assetType: true, site: true },
      orderBy: [{ nextEvaluationDate: { sort: "asc", nulls: "first" } }, { number: "asc" }],
      take: 300,
    }) : Promise.resolve([]),
    db.conditionEvaluation.count({ where: { orgId: ctx.org.id, asset: assetScope(ctx), status: "submitted" } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: evaluations.map((e) => e.evaluatedById).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
  const who = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const now = new Date();
  return (
    <>
      <PageHeader title="Quality" subtitle="Condition assessments rate each mold element on the health scale (5 Excellent … 1 Unacceptable). Approved results update the passport; Poor ratings or reported issues raise a work order, and Unacceptable quarantines the mold." actions={ctx.can("quality", "create") && <LinkButton href="/quality/assess">Start assessment</LinkButton>} />
      <SubTabs tabs={ctx.isSupplier ? QUALITY_TABS.slice(0, 1) : QUALITY_TABS} active="/quality" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/quality?view=${k}`} className={cx("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}{k === "pending" && ` (${pendingCount})`}</Link>)}
      </div>
      {view === "due" ? (
        due.length === 0 ? <EmptyState title="No evaluations due in the next 30 days" /> : (
          <Table head={["Mold", "Site", "Last score", "Last evaluated", "Next due", ""]}>
            {due.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/assets/${a.id}?tab=quality`} className="font-medium hover:text-brand-700">{a.number}</Link><p className="text-xs text-ink-500">{a.name}</p></Td>
                <Td className="text-xs">{a.site.name}</Td>
                <Td>{a.conditionScore != null ? <Badge color={BAND[scoreBand(a.conditionScore, a.assetType.evalThreshold)]}>{a.conditionScore.toFixed(2)}</Badge> : <span className="text-xs text-ink-500">Never</span>}</Td>
                <Td className="text-xs">{fmtDate(a.conditionDate, ctx.org.timezone)}</Td>
                <Td className={cx("text-xs", (!a.nextEvaluationDate || a.nextEvaluationDate < now) && "font-medium text-amber-700")}>{a.nextEvaluationDate ? fmtDate(a.nextEvaluationDate, ctx.org.timezone) : "Not yet scheduled"}</Td>
                <Td>{ctx.can("quality", "create") && <Link href={`/quality/evaluations/new?asset=${a.id}`} className="text-xs text-brand-700 hover:underline">Evaluate</Link>}</Td>
              </tr>
            ))}
          </Table>
        )
      ) : evaluations.length === 0 ? <EmptyState title={view === "pending" ? "Nothing awaiting approval" : "No evaluations yet"} /> : (
        <Table head={["Mold", "Score", "Evaluated", "By", "Status"]}>
          {evaluations.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50">
              <Td><Link href={`/quality/evaluations/${e.id}`} className="font-medium hover:text-brand-700">{e.asset.number}</Link><p className="text-xs text-ink-500">{e.asset.name}</p></Td>
              <Td><Badge color={BAND[scoreBand(e.score, e.asset.assetType.evalThreshold)]}>{e.score.toFixed(2)}</Badge></Td>
              <Td className="text-xs">{fmtDate(e.evaluatedAt, ctx.org.timezone)}</Td>
              <Td className="text-xs">{who(e.evaluatedById)}</Td>
              <Td><Badge status={EV_STATUS[e.status as keyof typeof EV_STATUS]}>{e.status}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
