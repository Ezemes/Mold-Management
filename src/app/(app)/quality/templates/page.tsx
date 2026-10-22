import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { componentLines, ensureTemplates, NA_DESC, RATINGS, type Component } from "@/lib/inspection";
import { PROCESSES } from "@/lib/calc.pure";
import { Badge, Card, cx, Field, FlashFromParams, Input, PageHeader, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { QUALITY_TABS } from "@/lib/tabs";
import { saveEvalSettingsAction, saveTemplateAction } from "../actions";

export const metadata = { title: "Inspection templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ edit?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  await ensureTemplates(ctx.org.id);
  const [templates, types] = await Promise.all([
    db.inspectionTemplate.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.assetType.findMany({ where: { orgId: ctx.org.id, archived: false }, orderBy: { createdAt: "asc" } }),
  ]);
  const canEdit = ctx.can("quality", "approve") && !ctx.isSupplier;
  const editing = sp.edit === "new" ? "new" : templates.find((t) => t.id === sp.edit);
  const e = editing && editing !== "new" ? editing : null;
  return (
    <>
      <PageHeader title="Quality" subtitle="Inspection templates list the mold elements to rate, with optional YES/NO key points. A mold uses the template for its process (department); the default template covers the rest." actions={canEdit && <Link href="/quality/templates?edit=new" className="text-sm text-brand-700 hover:underline">New template</Link>} />
      <SubTabs tabs={QUALITY_TABS} active="/quality/templates" />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Table head={["Template", "Processes", "Components", "Key points", ""]}>
            {templates.map((t) => {
              const cs = t.components as unknown as Component[];
              return (
                <tr key={t.id} className={cx(!t.active && "opacity-50")}>
                  <Td><span className="font-medium">{t.name}</span> {t.isDefault && <Badge color="blue">default</Badge>} {!t.active && <Badge color="gray">inactive</Badge>}</Td>
                  <Td className="text-xs">{t.processes.join(", ") || "—"}</Td>
                  <Td className="text-xs">{cs.length}</Td>
                  <Td className="text-xs">{cs.reduce((n, c) => n + c.checks.length, 0) || "—"}</Td>
                  <Td>{canEdit && <Link href={`/quality/templates?edit=${t.id}`} className="text-xs text-brand-700 hover:underline">Edit</Link>}</Td>
                </tr>
              );
            })}
          </Table>
          <Card title="Health rating scale">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {([5, 4, 3, 2, 1] as const).map((r) => <div key={r}><dt className="font-medium">{r} · {RATINGS[r].word}</dt><dd className="text-xs text-ink-500">{RATINGS[r].desc}</dd></div>)}
              <div><dt className="font-medium">N/A · Not applicable</dt><dd className="text-xs text-ink-500">{NA_DESC}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-ink-500">Approving an assessment with any Unacceptable component quarantines the mold until a release work order is completed. Poor components, reported issues or a score below the threshold raise a corrective work order.</p>
          </Card>
          <Card title="Thresholds and intervals">
            <div className="space-y-3">
              {types.map((t) => (
                <form key={t.id} action={saveEvalSettingsAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="assetTypeId" value={t.id} />
                  <span className="w-40 text-sm font-medium">{t.name}</span>
                  <Field label="Threshold (1–5)" name={`threshold-${t.id}`}><Input name="threshold" inputMode="decimal" defaultValue={t.evalThreshold} disabled={!canEdit} className="w-24" /></Field>
                  <Field label="Every (days)" name={`interval-${t.id}`}><Input name="interval" inputMode="numeric" defaultValue={t.evalIntervalDays} disabled={!canEdit} className="w-24" /></Field>
                  {canEdit && <SubmitButton size="sm" variant="secondary">Save</SubmitButton>}
                </form>
              ))}
            </div>
          </Card>
        </div>
        {canEdit && editing && (
          <Card className="lg:col-span-2" title={e ? `Edit “${e.name}”` : "New template"}>
            <form action={saveTemplateAction} className="space-y-4" key={e?.id ?? "new"}>
              {e && <input type="hidden" name="id" value={e.id} />}
              <Field label="Name" name="name"><Input name="name" required defaultValue={e?.name ?? ""} /></Field>
              <Field label="Processes" name="processes" hint={`Comma separated, matching the mold's process: ${PROCESSES.join(", ")}.`}><Input name="processes" defaultValue={e?.processes.join(", ") ?? ""} /></Field>
              <Field label="Components" name="components" hint="One component per line, optionally “| weight”. Indented “- ” lines under a component are its YES/NO key points.">
                <Textarea name="components" rows={18} className="font-mono text-xs" defaultValue={e ? componentLines(e.components as unknown as Component[]) : ""} placeholder={"Cavities | 2\n  - Check parting line for damage\nVents"} />
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={e?.isDefault ?? false} /> Default template (for processes no template lists)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Active</label>
              <SubmitButton>Save template</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
