import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { OPEN_WO, PRIORITY_COLOR, WO_BADGE, WO_PRIORITY, WO_STATUS, WO_TYPES, workOrderScope } from "@/lib/work-orders";
import { label } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { Badge, cx, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { MaintTabs } from "@/components/maint-tabs";

export const metadata = { title: "Maintenance" };

const VIEWS = [
  ["mine", "Assigned to me"],
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
  ["all", "All"],
] as const;


export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ view?: string; type?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "view"]);
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? (ctx.isSupplier ? "open" : "mine");
  const now = new Date();
  const mine: Prisma.WorkOrderWhereInput = ctx.isSupplier ? { assignedPartnerId: ctx.scope.partnerId ?? "__none__" } : { assignedUserId: ctx.user.id };
  const where: Prisma.WorkOrderWhereInput = {
    mine: { ...mine, status: { in: OPEN_WO } },
    open: { status: { in: OPEN_WO } },
    overdue: { status: { in: OPEN_WO }, dueDate: { lt: now } },
    completed: { status: "completed" },
    all: {},
  }[view];
  const typeWhere = sp.type && sp.type in WO_TYPES ? { type: sp.type } : {};
  const [rows, counts] = await Promise.all([
    db.workOrder.findMany({
      where: { AND: [workOrderScope(ctx), where, typeWhere] },
      include: { asset: { select: { id: true, number: true, name: true } }, assignedUser: true, assignedPartner: true },
      orderBy: view === "completed" ? { completedAt: "desc" } : [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
    }),
    Promise.all([
      db.workOrder.count({ where: { AND: [workOrderScope(ctx), mine, { status: { in: OPEN_WO } }] } }),
      db.workOrder.count({ where: { AND: [workOrderScope(ctx), { status: { in: OPEN_WO }, dueDate: { lt: now } }] } }),
    ]),
  ]);
  const href = (v: string, t = sp.type) => `/maintenance?view=${v}${t ? `&type=${t}` : ""}`;
  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle={ctx.isSupplier ? "Work orders on molds your company holds or has been asked to service." : "Preventive maintenance, repairs and refurbishment, with a signed checklist on every job."}
        actions={ctx.can("maintenance", "create") && <LinkButton href="/maintenance/work-orders/new">New work order</LinkButton>}
      />
      <MaintTabs active="/maintenance" supplier={ctx.isSupplier} />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={href(k)} className={cx("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>
            {l}
            {k === "mine" && ` (${counts[0]})`}
            {k === "overdue" && counts[1] > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{counts[1]}</span>}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-gray-200" />
        {Object.entries(WO_TYPES).map(([k, l]) => (
          <Link key={k} href={href(view, sp.type === k ? "" : k)} className={cx("rounded-full px-2.5 py-1 text-xs ring-1 ring-inset", sp.type === k ? "bg-ink-900 text-white ring-ink-900" : "text-ink-500 ring-gray-200 hover:bg-gray-50")}>
            {l}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={view === "mine" ? "Nothing assigned to you" : "No work orders here"} body={view === "mine" ? "Work orders raised by plans, quarantines and disputes appear here when assigned to you." : undefined} />
      ) : (
        <Table head={["Work order", "Asset", "Type", "Priority", "Assigned to", "Due", "Status"]}>
          {rows.map((w) => {
            const overdue = OPEN_WO.includes(w.status) && w.dueDate && w.dueDate < now;
            return (
              <tr key={w.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`/maintenance/work-orders/${w.id}`} className="font-medium hover:text-brand-700">{w.number}</Link>
                  <p className="text-xs text-ink-500">{w.title}</p>
                </Td>
                <Td><Link href={`/assets/${w.asset.id}?tab=maintenance`} className="hover:text-brand-700">{w.asset.number}</Link><p className="text-xs text-ink-500">{w.asset.name}</p></Td>
                <Td className="text-xs">{label(WO_TYPES, w.type)}{w.source !== "manual" && <p className="text-ink-500">from {w.source.replace("_", " ")}</p>}</Td>
                <Td><Badge color={PRIORITY_COLOR[w.priority as keyof typeof PRIORITY_COLOR]}>{label(WO_PRIORITY, w.priority)}</Badge></Td>
                <Td className="text-xs">{w.assignedUser ? `${w.assignedUser.firstName} ${w.assignedUser.lastName}` : w.assignedPartner?.name ?? <span className="text-ink-500">Unassigned</span>}</Td>
                <Td className={cx("text-xs", overdue && "font-medium text-amber-700")}>
                  {fmtDate(w.dueDate, ctx.org.timezone)}
                  {w.dueAtShots != null && <p className="text-ink-500">at {w.dueAtShots.toLocaleString("en-IN")} shots</p>}
                </Td>
                <Td><Badge status={WO_BADGE[w.status]}>{label(WO_STATUS, w.status)}</Badge></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
