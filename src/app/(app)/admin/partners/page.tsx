import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { PARTNER_KINDS } from "@/lib/assets";
import { label } from "@/lib/labels";
import { Badge, Card, FlashFromParams, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { savePartnerAction } from "../actions";
import { PartnerFields } from "../partner-form";

export const metadata = { title: "Partners" };

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["partners", "view"]);
  const partners = await db.partner.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true, memberships: true, custodyAssets: { where: { deletedAt: null } } } } },
  });
  return (
    <>
      <PageHeader title="Partners" subtitle="Molders, toolmakers, warehouses and other companies in your network. Molds in a partner's custody are visible to that partner's users only." />
      <FlashFromParams params={sp} />
      <Table head={["Partner", "Type", "Sites", "Users", "Molds in custody", ""]} empty="No partners yet.">
        {partners.map((p) => (
          <tr key={p.id} className="hover:bg-gray-50">
            <Td><Link href={`/admin/partners/${p.id}`} className="font-medium hover:text-brand-700">{p.name}</Link>{p.gstin && <p className="text-xs text-ink-500">GSTIN {p.gstin}</p>}</Td>
            <Td>{label(PARTNER_KINDS, p.kind)}</Td>
            <Td>{p._count.sites}</Td>
            <Td>{p._count.memberships}</Td>
            <Td><Link href={`/assets?custodian=${p.id}`} className="hover:text-brand-700">{p._count.custodyAssets}</Link></Td>
            <Td>{p.status !== "active" && <Badge status={p.status} />}</Td>
          </tr>
        ))}
      </Table>
      {ctx.can("partners", "create") && (
        <Card title="Add a partner" className="mt-6">
          <form action={savePartnerAction} className="space-y-4">
            <PartnerFields />
            <SubmitButton>Add partner</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
