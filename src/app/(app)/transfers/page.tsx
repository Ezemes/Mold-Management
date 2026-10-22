import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { actsFor, TRANSFER_REASONS, TRANSFER_STATUS, transferScope } from "@/lib/transfers";
import { label } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { Badge, cx, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Transfers" };

const VIEWS = [
  ["action", "Needs my action"],
  ["open", "Open"],
  ["completed", "Completed"],
  ["all", "All"],
] as const;

const STATUS_BADGE: Record<string, string> = { requested: "pending", approved: "validated", in_transit: "in_transfer", disputed: "quarantined", completed: "active", rejected: "suspended", cancelled: "archived", draft: "inactive" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["transfers", "view"]);
  const view = VIEWS.find(([k]) => k === sp.view)?.[0] ?? "action";
  const statusWhere: Prisma.TransferWhereInput =
    view === "open" || view === "action" ? { status: { in: ["draft", "requested", "approved", "in_transit", "disputed"] } } : view === "completed" ? { status: "completed" } : {};
  const rows = await db.transfer.findMany({
    where: { AND: [transferScope(ctx), statusWhere] },
    include: { fromSite: true, toSite: true, fromPartner: true, toPartner: true, items: { include: { asset: { select: { number: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const needsMe = (t: (typeof rows)[number]) =>
    (t.status === "draft" && t.createdById === ctx.user.id) ||
    (t.status === "requested" && ctx.can("transfers", "approve") && !ctx.isSupplier) ||
    (t.status === "approved" && ctx.can("transfers", "edit") && actsFor(ctx, t.fromSite)) ||
    (t.status === "in_transit" && ctx.can("transfers", "edit") && actsFor(ctx, t.toSite)) ||
    (t.status === "disputed" && ctx.can("transfers", "approve") && !ctx.isSupplier);
  const list = view === "action" ? rows.filter(needsMe) : rows;
  const party = (site: { name: string }, p: { name: string } | null) => <><p className="font-medium">{p?.name ?? ctx.org.name}</p><p className="text-xs text-ink-500">{site.name}</p></>;
  return (
    <>
      <PageHeader title="Transfers" subtitle="Moving molds between companies and sites, with a handover record at each end." actions={ctx.can("transfers", "create") && <LinkButton href="/transfers/new">New transfer</LinkButton>} />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/transfers?view=${k}`} className={cx("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}{k === "action" && ` (${rows.filter(needsMe).length})`}</Link>)}
      </div>
      {list.length === 0 ? <EmptyState title={view === "action" ? "Nothing waiting for you" : "No transfers"} /> : (
        <Table head={["Transfer", "From", "To", "Assets", "Reason", "Needed by", "Status"]}>
          {list.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <Td><Link href={`/transfers/${t.id}`} className="font-medium hover:text-brand-700">{t.number}</Link></Td>
              <Td>{party(t.fromSite, t.fromPartner)}</Td>
              <Td>{party(t.toSite, t.toPartner)}</Td>
              <Td className="text-xs">{t.items.slice(0, 3).map((i) => i.asset.number).join(", ")}{t.items.length > 3 && ` +${t.items.length - 3}`}</Td>
              <Td className="text-xs">{label(TRANSFER_REASONS, t.reason)}</Td>
              <Td className="text-xs">{fmtDate(t.neededBy, ctx.org.timezone)}</Td>
              <Td><Badge status={STATUS_BADGE[t.status]}>{label(TRANSFER_STATUS, t.status)}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
