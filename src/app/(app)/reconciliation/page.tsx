import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { fmtDate, fmtNum } from "@/lib/format";
import { Badge, Card, cx, EmptyState, Field, FlashFromParams, Input, PageHeader, Stat, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { acceptExceptionAction, importProductionAction, resolveExceptionAction } from "./actions";

export const metadata = { title: "Shot reconciliation" };

const VIEWS = [["open", "Open exceptions"], ["closed", "Closed"], ["reports", "Production reports"]] as const;
const REPORT_BADGE = { matched: "green", exception: "red", pending: "blue", unverifiable: "gray" } as const;

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["readings", "view"]);
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? "open";
  const scope = { orgId: ctx.org.id, asset: assetScope(ctx) };
  const [counts, exceptions, reports] = await Promise.all([
    Promise.all(["open", "pending", "matched"].map((s) => (s === "open" ? db.reconciliationException.count({ where: { ...scope, status: "open" } }) : db.productionReport.count({ where: { ...scope, status: s } })))),
    view === "reports" ? Promise.resolve([]) : db.reconciliationException.findMany({ where: { ...scope, status: view === "open" ? "open" : { in: ["accepted", "resolved"] } }, include: { asset: true, report: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    view === "reports" ? db.productionReport.findMany({ where: scope, include: { asset: true }, orderBy: { periodEnd: "desc" }, take: 300 }) : Promise.resolve([]),
  ]);
  const o = ctx.org;
  const n = (v: number | null) => fmtNum(v, o);
  const canDecide = ctx.can("readings", "edit");
  return (
    <>
      <PageHeader title="Shot reconciliation" subtitle={`Production quantities are checked against each mold's counter: parts ÷ cavities vs counted shots, allowing ${o.reconTolerancePct}% (at least ${n(o.reconMinShots)} shots). Readings must fall within ${o.reconWindowDays} day(s) of each period's start and end.`} />
      <FlashFromParams params={sp} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Open exceptions" value={<span className={cx(counts[0] > 0 && "text-red-700")}>{counts[0]}</span>} />
        <Stat label="Waiting for readings" value={counts[1]} hint="Rechecked whenever readings arrive and daily" />
        <Stat label="Matched" value={counts[2]} />
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/reconciliation?view=${k}`} className={cx("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>)}
      </div>

      {view !== "reports" && (exceptions.length === 0 ? <EmptyState title={view === "open" ? "No open exceptions" : "Nothing closed yet"} /> : (
        <Table head={["Mold", "Period", "Parts", "Expected shots", "Counted shots", "Gap", view === "open" ? "Decide" : "Outcome"]}>
          {exceptions.map((x) => (
            <tr key={x.id}>
              <Td><Link href={`/assets/${x.assetId}?tab=counter`} className="font-medium hover:text-brand-700">{x.asset.number}</Link><p className="text-xs text-ink-500">{x.asset.name}{x.report.partNumber && ` · ${x.report.partNumber}`}</p></Td>
              <Td className="text-xs">{fmtDate(x.report.periodStart, o.timezone)} – {fmtDate(new Date(x.report.periodEnd.getTime() - 1), o.timezone)}</Td>
              <Td>{n(x.report.parts)}</Td>
              <Td>{n(x.expectedShots)}</Td>
              <Td>{n(x.recordedShots)}</Td>
              <Td className={x.gap > 0 ? "text-amber-700" : "text-red-700"}>{x.gap > 0 ? "+" : ""}{n(x.gap)}<p className="text-xs">{x.gapPct > 0 ? "+" : ""}{x.gapPct}%</p><p className="text-xs text-ink-500">{x.gap > 0 ? "more shots than parts" : "fewer shots than parts"}</p></Td>
              <Td>
                {view === "open" ? (canDecide ? (
                  <form action={acceptExceptionAction} className="flex min-w-64 flex-col gap-1">
                    <input type="hidden" name="id" value={x.id} />
                    <Input name="resolution" placeholder="Explanation or correction" aria-label="Explanation" className="py-1 text-xs" />
                    <div className="flex gap-1">
                      <SubmitButton size="sm" variant="secondary">Accept gap</SubmitButton>
                      <SubmitButton size="sm" variant="ghost" formAction={resolveExceptionAction}>Data corrected</SubmitButton>
                    </div>
                  </form>
                ) : <Badge color="red">open</Badge>) : (
                  <><Badge color={x.status === "accepted" ? "amber" : "green"}>{x.status}</Badge><p className="mt-1 max-w-xs text-xs">{x.resolution}</p></>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      ))}

      {view === "reports" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Table head={["Mold", "Period", "Parts", "Expected", "Counted", "Source", "Status"]} empty="No production reported yet.">
              {reports.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/assets/${r.assetId}`} className="font-medium hover:text-brand-700">{r.asset.number}</Link>{r.partNumber && <p className="text-xs text-ink-500">{r.partNumber}</p>}</Td>
                  <Td className="text-xs">{fmtDate(r.periodStart, o.timezone)} – {fmtDate(new Date(r.periodEnd.getTime() - 1), o.timezone)}</Td>
                  <Td>{n(r.parts)}</Td>
                  <Td className="text-xs">{n(r.expectedShots)}</Td>
                  <Td className="text-xs">{n(r.recordedShots)}</Td>
                  <Td className="text-xs">{r.source}{r.reference && <p className="text-ink-500">{r.reference}</p>}</Td>
                  <Td><Badge color={REPORT_BADGE[r.status as keyof typeof REPORT_BADGE]}>{r.status === "pending" ? "waiting for readings" : r.status}</Badge></Td>
                </tr>
              ))}
            </Table>
          </div>
          {ctx.can("readings", "create") && (
            <Card title="Import production">
              <form action={importProductionAction} className="space-y-3">
                <Field label="Rows" name="rows" hint="asset, period_start, period_end, parts, part_number, reference — dates as YYYY-MM-DD or DD-MM-YYYY (end date inclusive) or ISO date-times. Systems can send the same data to POST /api/v1/production.">
                  <Textarea name="rows" rows={6} className="font-mono text-xs" placeholder={"M-0003, 2026-10-01, 2026-10-07, 64000, TN-0003-A, MES-881"} />
                </Field>
                <Field label="…or a CSV file" name="file"><input type="file" name="file" accept=".csv,text/csv" className="block text-sm" /></Field>
                <SubmitButton pendingText="Importing…">Import and reconcile</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
