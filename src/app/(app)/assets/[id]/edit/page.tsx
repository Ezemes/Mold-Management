import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { loadPassport } from "@/lib/passport";
import { Card, Field, FlashFromParams, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { updateAssetAction } from "../../actions";
import { CustomFields, StandardFields } from "../../asset-fields";

export default async function EditAssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "edit"]);
  const p = await loadPassport(ctx, id);
  if (!p) notFound();
  const a = p.asset;
  const partners = await db.partner.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader back={{ href: `/assets/${a.id}`, label: a.number }} title={`Edit ${a.number}`} subtitle="Location and custody are changed from the passport, not here." />
      <FlashFromParams params={sp} />
      <Card>
        <form action={updateAssetAction} className="space-y-6">
          <input type="hidden" name="id" value={a.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" className="sm:col-span-2"><Input name="name" defaultValue={a.name} required /></Field>
            <Field label="Owner"><Select name="ownerPartnerId" defaultValue={a.ownerPartnerId ?? ""} options={partners.map((x) => [x.id, x.name] as [string, string])} placeholder={ctx.org.name} /></Field>
            <Field label="Program / customer"><Input name="program" defaultValue={a.program} /></Field>
            <Field label="Assignment" hint="What it is planned to run on"><Input name="assignment" defaultValue={a.assignment} /></Field>
            {a.assetType.kind === "mold" && <Field label="Toolmaker"><Select name="toolmakerPartnerId" defaultValue={a.toolmakerPartnerId ?? ""} options={partners.filter((x) => x.kind === "toolmaker").map((x) => [x.id, x.name] as [string, string])} placeholder="—" /></Field>}
          </div>
          <StandardFields kind={a.assetType.kind} a={a} />
          <CustomFields defs={a.assetType.fields} values={a.customValues as Record<string, unknown>} />
          <Field label="Notes"><Textarea name="notes" defaultValue={a.notes} /></Field>
          <SubmitButton>Save</SubmitButton>
        </form>
      </Card>
    </>
  );
}
