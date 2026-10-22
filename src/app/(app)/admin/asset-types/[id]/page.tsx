import { notFound } from "next/navigation";
import type { FieldDef } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { FEATURE_LABELS, FORMULA_HELP, features, stdFieldsFor } from "@/lib/assets";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveAssetTypeAction, saveFieldAction } from "../actions";

const TYPES = { text: "Text", number: "Number", date: "Date", boolean: "Yes / no", picklist: "Picklist", formula: "Formula (calculated)" };

function FieldForm({ typeId, f }: { typeId: string; f?: FieldDef }) {
  return (
    <form action={saveFieldAction} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="typeId" value={typeId} />
      {f && <input type="hidden" name="id" value={f.id} />}
      <Field label="Label"><Input name="label" defaultValue={f?.label} required /></Field>
      {f ? <Field label="Key"><Input value={f.key} disabled /></Field> : <Field label="Key (optional)" hint="Used in formulas and CSV"><Input name="key" /></Field>}
      {f ? <Field label="Type"><Input value={TYPES[f.type as keyof typeof TYPES]} disabled /></Field> : <Field label="Type"><Select name="type" options={TYPES} /></Field>}
      <Field label="Unit"><Input name="unit" defaultValue={f?.unit} placeholder="e.g. °C, bar" /></Field>
      <Field label="Picklist options" className="sm:col-span-2" hint="Comma or line separated"><Textarea name="options" rows={2} defaultValue={f?.options.join(", ")} /></Field>
      <Field label="Formula" className="sm:col-span-2" hint={FORMULA_HELP}><Input name="formula" defaultValue={f?.formula} placeholder="active_cavities * 3600 / design_cycle_time_s" /></Field>
      <Field label="Section"><Input name="section" defaultValue={f?.section ?? "Additional"} /></Field>
      <Field label="Order"><Input name="sortOrder" type="number" defaultValue={f?.sortOrder ?? 0} /></Field>
      <Field label="Help text" className="sm:col-span-2"><Input name="helpText" defaultValue={f?.helpText} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" defaultChecked={f?.required} /> Required</label>
      {f && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" defaultChecked={f.archived} /> Archived (hidden)</label>}
      <div className="sm:col-span-4"><SubmitButton size="sm">{f ? "Save field" : "Add field"}</SubmitButton></div>
    </form>
  );
}

export default async function AssetTypePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["asset_types", "view"]);
  const t = await db.assetType.findFirst({ where: { id, orgId: ctx.org.id }, include: { fields: { orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] } } });
  if (!t) notFound();
  const f = features(t.features);
  const canEdit = ctx.can("asset_types", "edit");
  return (
    <>
      <PageHeader back={{ href: "/admin/asset-types", label: "Asset types" }} title={t.name} subtitle={`Kind: ${t.kind} · key ${t.key}`} />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title={`Custom fields (${t.fields.length})`}>
            <Table head={["Field", "Key", "Type", "Section", ""]} empty="No custom fields yet.">
              {t.fields.map((x) => (
                <tr key={x.id}>
                  <Td>
                    <details>
                      <summary className="cursor-pointer font-medium">{x.label}{x.unit && <span className="text-ink-500"> ({x.unit})</span>}</summary>
                      {canEdit && <div className="mt-3"><FieldForm typeId={t.id} f={x} /></div>}
                    </details>
                  </Td>
                  <Td><code className="text-xs">{x.key}</code></Td>
                  <Td className="text-xs">{TYPES[x.type as keyof typeof TYPES]}{x.type === "formula" && <p className="font-mono text-ink-500">{x.formula}</p>}{x.type === "picklist" && <p className="text-ink-500">{x.options.join(" · ")}</p>}</Td>
                  <Td className="text-xs">{x.section}</Td>
                  <Td className="space-x-1">{x.required && <Badge color="blue">required</Badge>}{x.archived && <Badge status="archived" />}</Td>
                </tr>
              ))}
            </Table>
            {canEdit && <div className="mt-6 border-t border-gray-100 pt-4"><p className="mb-3 text-sm font-semibold">Add a field</p><FieldForm typeId={t.id} /></div>}
          </Card>
          <Card title="Standard fields for this kind">
            <p className="text-sm text-ink-700">{stdFieldsFor(t.kind).map((s) => `${s.label} (${s.var})`).join(" · ") || "None"}</p>
          </Card>
        </div>
        <Card title="Type settings">
          <form action={saveAssetTypeAction} className="space-y-3">
            <input type="hidden" name="id" value={t.id} />
            <Field label="Name"><Input name="name" defaultValue={t.name} required /></Field>
            <Field label="Number prefix"><Input name="numberPrefix" defaultValue={t.numberPrefix} /></Field>
            <Field label="Description"><Input name="description" defaultValue={t.description} /></Field>
            <fieldset className="space-y-1 text-sm">
              <legend className="label">Features</legend>
              {Object.entries(FEATURE_LABELS).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`feature.${k}`} defaultChecked={f[k as keyof typeof f]} /> {l}</label>)}
            </fieldset>
            <Field label="Status"><Select name="archived" defaultValue={t.archived ? "1" : "0"} options={{ "0": "Active", "1": "Archived (no new assets)" }} /></Field>
            {canEdit && <SubmitButton size="sm">Save type</SubmitButton>}
          </form>
        </Card>
      </div>
    </>
  );
}
