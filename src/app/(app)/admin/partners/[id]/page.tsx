import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { Card, Field, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { inviteUserAction, savePartnerAction, saveSiteAction } from "../../actions";
import { PartnerFields } from "../../partner-form";
import { SiteFields } from "../../site-form";

export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["partners", "view"]);
  const p = await db.partner.findFirst({
    where: { id, orgId: ctx.org.id },
    include: { sites: { orderBy: { name: "asc" } }, memberships: { include: { user: true, role: true } }, invites: { where: { status: "pending" }, include: { role: true } }, _count: { select: { custodyAssets: { where: { deletedAt: null } } } } },
  });
  if (!p) notFound();
  const [divisions, supplierRoles] = await Promise.all([
    db.division.findMany({ where: { orgId: ctx.org.id } }),
    db.role.findMany({ where: { orgId: ctx.org.id, isSupplier: true } }),
  ]);
  const ret = `/admin/partners/${p.id}`;
  return (
    <>
      <PageHeader back={{ href: "/admin/partners", label: "Partners" }} title={p.name} subtitle={<Link className="text-brand-700 hover:underline" href={`/assets?custodian=${p.id}`}>{p._count.custodyAssets} molds in custody →</Link>} />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details" className="lg:col-span-2">
          <form action={savePartnerAction} className="space-y-4">
            <input type="hidden" name="id" value={p.id} />
            <PartnerFields p={p} />
            {ctx.can("partners", "edit") && <SubmitButton>Save partner</SubmitButton>}
          </form>
        </Card>
        <Card title={`Sites (${p.sites.length})`}>
          <ul className="mb-4 space-y-1 text-sm">
            {p.sites.map((s) => <li key={s.id}><Link href={`/admin/sites/${s.id}`} className="hover:text-brand-700">{s.name}</Link> <span className="text-xs text-ink-500">{[s.city, s.state].filter(Boolean).join(", ")}</span></li>)}
            {!p.sites.length && <li className="text-ink-500">No sites. Molds held by this partner need a site.</li>}
          </ul>
          {ctx.can("sites", "create") && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">+ Add a site for {p.name}</summary>
              <form action={saveSiteAction} className="mt-3 space-y-3">
                <SiteFields divisions={divisions} partners={[]} fixedPartnerId={p.id} />
                <SubmitButton size="sm">Add site</SubmitButton>
              </form>
            </details>
          )}
        </Card>
        <Card title="Partner users">
          <Table head={["User", "Role"]} empty="No users yet.">
            {p.memberships.map((m) => <tr key={m.id}><Td><Link href={`/admin/users/${m.id}`} className="hover:text-brand-700">{m.user.email}</Link></Td><Td>{m.role.name}</Td></tr>)}
            {p.invites.map((i) => <tr key={i.id}><Td>{i.email} <span className="text-xs text-ink-500">(invited)</span></Td><Td>{i.role.name}</Td></tr>)}
          </Table>
          {ctx.can("users", "create") && (
            <form action={inviteUserAction} className="mt-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="partnerId" value={p.id} />
              <input type="hidden" name="return" value={ret} />
              <Field label="Invite email" className="min-w-48 flex-1"><Input name="email" type="email" required /></Field>
              <Field label="Role"><Select name="roleId" options={supplierRoles.map((r) => [r.id, r.name] as [string, string])} /></Field>
              <SubmitButton size="sm">Invite</SubmitButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
