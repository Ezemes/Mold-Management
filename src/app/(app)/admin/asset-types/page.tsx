import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { FEATURE_LABELS, features } from "@/lib/assets";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveAssetTypeAction } from "./actions";

export const metadata = { title: "Asset types" };

export default async function AssetTypesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["asset_types", "view"]);
  const types = await db.assetType.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { fields: true, assets: { where: { deletedAt: null } } } } } });
  return (
    <>
      <PageHeader title="Asset types & custom fields" subtitle="Each type decides which standard fields and tabs appear, and adds its own custom fields." />
      <FlashFromParams params={sp} />
      <Table head={["Type", "Kind", "Number prefix", "Features", "Custom fields", "Assets"]}>
        {types.map((t) => {
          const f = features(t.features);
          return (
            <tr key={t.id} className="hover:bg-gray-50">
              <Td><Link href={`/admin/asset-types/${t.id}`} className="font-medium hover:text-brand-700">{t.name}</Link>{t.archived && <> <Badge status="archived" /></>}</Td>
              <Td className="capitalize">{t.kind}</Td>
              <Td><code className="text-xs">{t.numberPrefix || "—"}</code></Td>
              <Td className="text-xs text-ink-700">{(Object.keys(FEATURE_LABELS) as (keyof typeof f)[]).filter((k) => f[k]).map((k) => FEATURE_LABELS[k]).join(", ") || "—"}</Td>
              <Td>{t._count.fields}</Td>
              <Td>{t._count.assets}</Td>
            </tr>
          );
        })}
      </Table>
      {ctx.can("asset_types", "create") && (
        <Card title="New asset type" className="mt-6">
          <form action={saveAssetTypeAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Name" className="sm:col-span-2"><Input name="name" required placeholder="e.g. Blow mold" /></Field>
              <Field label="Kind" hint="Decides the standard fields shown."><Select name="kind" options={{ mold: "Mold", press: "Press", equipment: "Equipment" }} /></Field>
              <Field label="Number prefix"><Input name="numberPrefix" placeholder="BM-" /></Field>
              <Field label="Description" className="sm:col-span-4"><Input name="description" /></Field>
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              {Object.entries(FEATURE_LABELS).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`feature.${k}`} defaultChecked={k === "documents"} /> {l}</label>)}
            </fieldset>
            <SubmitButton>Create type</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
