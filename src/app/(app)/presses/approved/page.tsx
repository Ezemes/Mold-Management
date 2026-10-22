import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Badge, cx, FlashFromParams, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { PRESS_TABS } from "@/lib/tabs";
import { revokePairAction } from "../actions";

export const metadata = { title: "Approved mold–press pairs" };

export default async function ApprovedPairsPage({ searchParams }: { searchParams: Promise<{ show?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "view"]);
  const all = sp.show === "all";
  const pairs = await db.moldPress.findMany({
    where: { orgId: ctx.org.id, mold: assetScope(ctx), ...(all ? {} : { status: "approved" }) },
    include: { mold: { include: { site: true } }, press: { include: { site: true } } },
    orderBy: [{ status: "asc" }, { approvedAt: "desc" }],
  });
  const quals = await db.qualification.findMany({ where: { id: { in: pairs.map((p) => p.qualificationId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const canRevoke = ctx.can("quality", "approve") && !ctx.isSupplier;
  return (
    <>
      <PageHeader title="Presses" subtitle="A pair is approved when the mold passes PQ on that press. Other compatible pairs are unqualified." />
      <SubTabs tabs={PRESS_TABS} active="/presses/approved" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex gap-1 text-sm">
        {[["", "Approved"], ["all", "Including withdrawn"]].map(([k, l]) => (
          <Link key={k} href={`/presses/approved${k ? `?show=${k}` : ""}`} className={cx("rounded-md px-3 py-1.5", (sp.show ?? "") === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>
        ))}
      </div>
      <Table head={["Mold", "Press", "Approved", "From", "Status", ""]} empty="No approved pairs yet. Pass a PQ on a press under Quality → Qualifications.">
        {pairs.map((p) => {
          const q = quals.find((x) => x.id === p.qualificationId);
          return (
            <tr key={p.id}>
              <Td><Link href={`/assets/${p.moldId}?tab=presses`} className="font-medium hover:text-brand-700">{p.mold.number}</Link><p className="text-xs text-ink-500">{p.mold.name} · {p.mold.site.name}</p></Td>
              <Td><Link href={`/assets/${p.pressId}?tab=presses`} className="font-medium hover:text-brand-700">{p.press.number}</Link><p className="text-xs text-ink-500">{p.press.name} · {p.press.site.name}</p></Td>
              <Td className="text-xs">{fmtDate(p.approvedAt, ctx.org.timezone)}</Td>
              <Td className="text-xs">{q ? <Link href={`/quality/qualifications/${q.id}`} className="text-brand-700 hover:underline">{q.number}</Link> : "—"}</Td>
              <Td>{p.status === "approved" ? <Badge color="green">Approved</Badge> : <><Badge color="gray">Withdrawn</Badge><p className="mt-1 text-xs text-ink-500">{p.revokedReason}</p></>}</Td>
              <Td>
                {canRevoke && p.status === "approved" && (
                  <form action={revokePairAction} className="flex gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <Input name="reason" placeholder="Reason" aria-label="Reason for withdrawing" className="w-36 py-1 text-xs" />
                    <SubmitButton size="sm" variant="ghost" confirm="Withdraw this approval?">Withdraw</SubmitButton>
                  </form>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
