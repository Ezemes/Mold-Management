import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireOrg(["reports", "view"]);
  const more: [string, string, string, boolean][] = [
    ["/maintenance/reports", "Maintenance compliance", "PM on-time %, overdue work, MTTR and MTBF.", ctx.can("maintenance")],
    ["/downtime/reports", "MTBF and availability", "Downtime by mold, asset type or site, and the reasons that cost the most hours.", ctx.can("downtime")],
    ["/planning/capacity", "Capacity shortfalls", "Months where product demand exceeds mold capacity.", ctx.can("planning")],
    ["/inventory/reorder", "Reorder list", "Spare parts at or below their reorder point.", ctx.can("inventory")],
    ["/admin/audit", "Audit log", "Every change, exportable.", ctx.can("audit")],
  ];
  return (
    <>
      <PageHeader title="Reports" subtitle="Standard reports for your scope. Each one exports to CSV, which opens in Excel." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(REPORTS).map(([k, r]) => (
          <Link key={k} href={`/reports/${k}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-300">
            <p className="font-medium text-ink-900">{r.title}</p>
            <p className="mt-1 text-sm text-ink-500">{r.description}</p>
          </Link>
        ))}
        {more.filter((m) => m[3]).map(([href, t, d]) => (
          <Link key={href} href={href} className="rounded-lg border border-dashed border-gray-300 bg-white p-4 hover:border-brand-300">
            <p className="font-medium text-ink-900">{t} →</p>
            <p className="mt-1 text-sm text-ink-500">{d}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
