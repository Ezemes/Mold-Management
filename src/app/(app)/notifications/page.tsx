import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { cx, EmptyState, FlashFromParams, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { markAllReadAction } from "./actions";

export const metadata = { title: "Alerts" };

const GROUPS: [string, string][] = [["transfer_", "Transfers"], ["wo_", "Work orders"], ["pm_", "Maintenance"], ["reading_", "Readings"], ["life_", "Life"]];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const unreadOnly = sp.show !== "all";
  const rows = await db.notification.findMany({ where: { userId: ctx.user.id, orgId: ctx.org.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const unread = unreadOnly ? rows.length : rows.filter((r) => !r.readAt).length;
  const group = (kind: string) => GROUPS.find(([p]) => kind.startsWith(p))?.[1] ?? "General";
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Approvals, handovers, maintenance due and overdue readings. Each alert is also emailed to you."
        actions={unread > 0 && (
          <form action={markAllReadAction}>
            <SubmitButton variant="secondary">Mark all as read</SubmitButton>
          </form>
        )}
      />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex gap-1">
        {[["unread", "Unread"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/notifications?show=${k}`} className={cx("rounded-md px-3 py-1.5 text-sm", (unreadOnly ? "unread" : "all") === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>
        ))}
      </div>
      {rows.length === 0 ? <EmptyState title={unreadOnly ? "You're all caught up" : "No alerts yet"} /> : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={`/notifications/${n.id}`} className={cx("flex items-start gap-3 px-4 py-3 hover:bg-gray-50", !n.readAt && "bg-brand-50/40")}>
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900">{n.title}</span>
                  {n.body && <span className="block text-sm text-ink-700">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-ink-500">{group(n.kind)} · {fmtDateTime(n.createdAt, ctx.org.timezone)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
