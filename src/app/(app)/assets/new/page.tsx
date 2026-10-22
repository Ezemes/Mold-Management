import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg, siteScope } from "@/lib/auth";
import { nextNumber } from "@/lib/asset-number";
import { Card, cx, Field, FlashFromParams, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createAssetAction } from "../actions";
import { CustomFields, StandardFields } from "../asset-fields";

export const metadata = { title: "New asset" };

export default async function NewAssetPage({ searchParams }: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "create"]);
  const types = await db.assetType.findMany({ where: { orgId: ctx.org.id, archived: false }, orderBy: { createdAt: "asc" }, include: { fields: { where: { archived: false }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
  const type = types.find((t) => t.id === sp.type) ?? types[0];
  const [sites, partners, suggested] = await Promise.all([
    db.site.findMany({ where: { AND: [siteScope(ctx), { active: true }] }, include: { partner: true }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: ctx.org.id, status: "active" }, orderBy: { name: "asc" } }),
    type ? nextNumber(ctx.org.id, type.numberPrefix) : Promise.resolve(""),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/assets", label: "Assets" }} title="New asset" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {types.map((t) => (
          <Link key={t.id} href={`/assets/new?type=${t.id}`} className={cx("rounded-md px-3 py-1.5 text-sm", t.id === type?.id ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{t.name}</Link>
        ))}
      </div>
      {type && (
        <Card>
          <form action={createAssetAction} className="space-y-6">
            <input type="hidden" name="assetTypeId" value={type.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Asset number" hint={`Leave empty for ${suggested}`}><Input name="number" placeholder={suggested} /></Field>
              <Field label="Name" className="sm:col-span-2"><Input name="name" required placeholder="e.g. Door trim LH 4-cav" /></Field>
              <Field label="Site" hint="Custody follows the site: a partner's site puts the asset in that partner's custody.">
                <Select name="siteId" options={sites.map((s) => [s.id, s.partner ? `${s.name} (${s.partner.name})` : s.name] as [string, string])} />
              </Field>
              <Field label="Location at site"><Input name="locationDetail" placeholder="e.g. Rack B-12" /></Field>
              <Field label="Owner" hint="Leave as your organisation unless a customer owns it."><Select name="ownerPartnerId" options={partners.map((p) => [p.id, p.name] as [string, string])} placeholder={ctx.org.name} /></Field>
              <Field label="Program / customer"><Input name="program" /></Field>
              {type.kind === "mold" && <Field label="Toolmaker"><Select name="toolmakerPartnerId" options={partners.filter((p) => p.kind === "toolmaker").map((p) => [p.id, p.name] as [string, string])} placeholder="—" /></Field>}
            </div>
            <StandardFields kind={type.kind} />
            <CustomFields defs={type.fields} />
            <Field label="Notes"><Textarea name="notes" /></Field>
            <SubmitButton>Create {type.name.toLowerCase()}</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
