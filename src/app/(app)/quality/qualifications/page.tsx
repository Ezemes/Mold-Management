import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { currentStage, QUAL_STATUS } from "@/lib/quality";
import { label } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { QUALITY_TABS } from "@/lib/tabs";

export const metadata = { title: "Qualifications" };

const Q_BADGE = { in_progress: "pending", passed: "active", failed: "suspended", cancelled: "archived" } as const;

export default async function QualificationsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const [quals, needing] = await Promise.all([
    db.qualification.findMany({ where: { orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: true, press: true, stages: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 }),
    db.asset.findMany({ where: { AND: [assetScope(ctx), { requalificationReason: { not: "" }, qualifications: { none: { status: "in_progress" } } }] }, select: { id: true, number: true, name: true, requalificationReason: true } }),
  ]);
  const canCreate = ctx.can("quality", "create") && !ctx.isSupplier;
  return (
    <>
      <PageHeader title="Quality" subtitle="Qualification runs IQ → OQ → PQ. Passing PQ on a press approves that mold–press pair." actions={canCreate && <LinkButton href="/quality/qualifications/new">New qualification</LinkButton>} />
      <SubTabs tabs={QUALITY_TABS} active="/quality/qualifications" />
      <FlashFromParams params={sp} />
      {needing.length > 0 && (
        <Card title={`Re-qualification required (${needing.length})`} className="mb-6">
          <ul className="divide-y divide-gray-100 text-sm">
            {needing.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span><Link href={`/assets/${a.id}?tab=quality`} className="font-medium hover:text-brand-700">{a.number}</Link> {a.name}<span className="block text-xs text-ink-500">{a.requalificationReason}</span></span>
                {canCreate && <Link href={`/quality/qualifications/new?asset=${encodeURIComponent(a.number)}`} className="text-xs text-brand-700 hover:underline">Start</Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {quals.length === 0 ? <EmptyState title="No qualifications yet" /> : (
        <Table head={["Qualification", "Mold", "Press", "Kind", "Current stage", "Started", "Status"]}>
          {quals.map((q) => (
            <tr key={q.id} className="hover:bg-gray-50">
              <Td><Link href={`/quality/qualifications/${q.id}`} className="font-medium hover:text-brand-700">{q.number}</Link></Td>
              <Td>{q.asset.number}<p className="text-xs text-ink-500">{q.asset.name}</p></Td>
              <Td className="text-xs">{q.press ? `${q.press.number} ${q.press.name}` : "—"}</Td>
              <Td className="text-xs">{q.kind === "requalification" ? "Re-qualification" : "Initial"}</Td>
              <Td className="text-xs">{q.status === "in_progress" ? currentStage(q.stages) ?? "—" : "—"}</Td>
              <Td className="text-xs">{fmtDate(q.createdAt, ctx.org.timezone)}</Td>
              <Td><Badge status={Q_BADGE[q.status as keyof typeof Q_BADGE]}>{label(QUAL_STATUS, q.status)}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
