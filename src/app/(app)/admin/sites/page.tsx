import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { SITE_KINDS } from "@/lib/assets";
import { label } from "@/lib/labels";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveDivisionAction, saveSiteAction } from "../actions";
import { SiteFields } from "../site-form";

export const metadata = { title: "Sites & divisions" };

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["sites", "view"]);
  const oid = ctx.org.id;
  const [sites, divisions, partners] = await Promise.all([
    db.site.findMany({ where: { orgId: oid }, include: { division: true, partner: true, _count: { select: { assets: { where: { deletedAt: null } } } } }, orderBy: [{ partnerId: "asc" }, { name: "asc" }] }),
    db.division.findMany({ where: { orgId: oid }, include: { _count: { select: { sites: true } } }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Sites & divisions" subtitle="Your plants and warehouses, plus partner sites where molds can be held. Divisions group your own sites." />
      <FlashFromParams params={sp} />
      <Table head={["Site", "Type", "Belongs to", "Division", "Location", "Assets", ""]}>
        {sites.map((s) => (
          <tr key={s.id} className="hover:bg-gray-50">
            <Td><Link href={`/admin/sites/${s.id}`} className="font-medium hover:text-brand-700">{s.name}</Link>{s.code && <span className="ml-1 text-xs text-ink-500">{s.code}</span>}</Td>
            <Td>{label(SITE_KINDS, s.kind)}</Td>
            <Td>{s.partner ? <Link href={`/admin/partners/${s.partner.id}`} className="hover:text-brand-700">{s.partner.name}</Link> : <span className="text-ink-500">Own</span>}</Td>
            <Td className="text-ink-700">{s.division?.name ?? "—"}</Td>
            <Td className="text-xs text-ink-700">{[s.city, s.state, s.country].filter(Boolean).join(", ")}</Td>
            <Td>{s._count.assets}</Td>
            <Td>{!s.active && <Badge status="inactive" />}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {ctx.can("sites", "create") && (
          <Card title="Add a site">
            <form action={saveSiteAction} className="space-y-4">
              <SiteFields divisions={divisions} partners={partners} />
              <SubmitButton>Add site</SubmitButton>
            </form>
          </Card>
        )}
        <Card title="Divisions">
          <ul className="mb-4 space-y-2 text-sm">
            {divisions.map((d) => (
              <li key={d.id}>
                <details>
                  <summary className="cursor-pointer">{d.name} {d.code && <span className="text-xs text-ink-500">({d.code})</span>} <span className="text-xs text-ink-500">· {d._count.sites} sites</span></summary>
                  {ctx.can("sites", "edit") && (
                    <form action={saveDivisionAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <Input name="name" defaultValue={d.name} required />
                      <Input name="code" defaultValue={d.code} className="w-24" />
                      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                    </form>
                  )}
                </details>
              </li>
            ))}
            {!divisions.length && <li className="text-ink-500">No divisions. They are optional.</li>}
          </ul>
          {ctx.can("sites", "create") && (
            <form action={saveDivisionAction} className="space-y-2 border-t border-gray-100 pt-3">
              <Field label="New division"><Input name="name" required placeholder="e.g. Automotive" /></Field>
              <Field label="Code"><Input name="code" /></Field>
              <SubmitButton size="sm">Add division</SubmitButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
