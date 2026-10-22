import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { buildReport, REPORTS, type Cell, type ReportKey } from "@/lib/reports";
import { fmtNum } from "@/lib/format";
import { cx, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(key in REPORTS)) notFound();
  const ctx = await requireOrg(["reports", "view"]);
  const r = await buildReport(ctx, key as ReportKey);
  const show = (v: Cell, i: number) => (v == null ? "—" : typeof v === "number" && r.numeric?.includes(i) ? fmtNum(v, ctx.org, Number.isInteger(v) ? 0 : 2) : v);
  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title={r.title} subtitle={r.description} actions={<LinkButton href={`/reports/${key}/export`} variant="secondary">Export CSV</LinkButton>} />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-ink-500">
            <tr>{r.columns.map((c, i) => <th key={c} className={cx("px-4 py-2.5 font-medium", r.numeric?.includes(i) ? "text-right" : "text-left")}>{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.length === 0 && <tr><td colSpan={r.columns.length} className="px-4 py-8 text-center text-ink-500">Nothing to report.</td></tr>}
            {r.rows.map((row, j) => <tr key={j}>{row.map((v, i) => <td key={i} className={cx("px-4 py-2", r.numeric?.includes(i) && "text-right tabular-nums")}>{show(v, i)}</td>)}</tr>)}
          </tbody>
          {r.footer && <tfoot className="border-t border-gray-200 bg-gray-50 font-medium"><tr>{r.footer.map((v, i) => <td key={i} className={cx("px-4 py-2", r.numeric?.includes(i) && "text-right tabular-nums")}>{show(v, i)}</td>)}</tr></tfoot>}
        </table>
      </div>
    </>
  );
}
