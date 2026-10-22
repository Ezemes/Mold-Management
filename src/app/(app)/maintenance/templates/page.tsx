import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { taskLines, TEMPLATE_KINDS, type TaskDef } from "@/lib/maintenance";
import { label } from "@/lib/labels";
import { Badge, Card, cx, EmptyState, Field, FlashFromParams, Input, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { MaintTabs } from "@/components/maint-tabs";
import { saveTemplateAction, toggleTemplateAction } from "../actions";

export const metadata = { title: "Maintenance templates" };

const EXAMPLE = `Clean parting line and vents
Check ejector pins for wear
measure: Cooling flow, circuit A [l/min] (8-12)
photo: Core side after cleaning
* Check hot runner zone temperatures`;

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ edit?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "view"]);
  const canManage = ctx.can("maintenance", "create") && !ctx.isSupplier;
  const templates = await db.maintenanceTemplate.findMany({ where: { orgId: ctx.org.id }, include: { _count: { select: { plans: { where: { active: true } } } } }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const editing = sp.edit ? templates.find((t) => t.id === sp.edit) : undefined;

  return (
    <>
      <PageHeader title="Maintenance" subtitle="Templates are reusable checklists. Plans apply them to assets on a shot or calendar interval." />
      <MaintTabs active="/maintenance/templates" supplier={ctx.isSupplier} />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {templates.length === 0 ? <EmptyState title="No templates yet" /> : (
            <Table head={["Template", "Kind", "Tasks", "Active plans", ""]}>
              {templates.map((t) => (
                <tr key={t.id} className={cx(!t.active && "opacity-50")}>
                  <Td>
                    <p className="font-medium">{t.name}</p>
                    {t.description && <p className="text-xs text-ink-500">{t.description}</p>}
                    {t.estimatedHours != null && <p className="text-xs text-ink-500">≈ {t.estimatedHours} h</p>}
                  </Td>
                  <Td className="text-xs">{label(TEMPLATE_KINDS, t.kind)}</Td>
                  <Td className="text-xs">{(t.tasks as unknown as TaskDef[]).length}</Td>
                  <Td className="text-xs">{t._count.plans}</Td>
                  <Td className="whitespace-nowrap">
                    {!t.active && <Badge status="inactive" />}
                    {canManage && (
                      <span className="ml-2 inline-flex gap-1">
                        <Link href={`/maintenance/templates?edit=${t.id}`} className="text-xs text-brand-700 hover:underline">Edit</Link>
                        <form action={toggleTemplateAction} className="inline">
                          <input type="hidden" name="id" value={t.id} />
                          <SubmitButton size="sm" variant="ghost" confirm={t.active ? "Deactivate this template? Its plans will be paused." : undefined}>{t.active ? "Deactivate" : "Activate"}</SubmitButton>
                        </form>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        {canManage && (
          <Card className="lg:col-span-2" title={editing ? `Edit “${editing.name}”` : "New template"} actions={editing && <Link href="/maintenance/templates" className="text-xs text-ink-500 hover:text-brand-700">New instead</Link>}>
            <form action={saveTemplateAction} className="space-y-4" key={editing?.id ?? "new"}>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field label="Name" name="name">
                <Input name="name" required defaultValue={editing?.name} placeholder="e.g. 50k shot PM" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kind" name="kind">
                  <Select name="kind" options={TEMPLATE_KINDS} defaultValue={editing?.kind ?? "preventive"} />
                </Field>
                <Field label="Estimated hours" name="estimatedHours">
                  <Input name="estimatedHours" inputMode="decimal" defaultValue={editing?.estimatedHours ?? ""} />
                </Field>
              </div>
              <Field label="Description" name="description">
                <Input name="description" defaultValue={editing?.description} />
              </Field>
              <Field label="Checklist tasks" name="tasks" hint="One per line. “measure: text [unit] (min-max)” records a value and fails outside the range; “photo:” asks for a photo; a leading * makes a task optional.">
                <Textarea name="tasks" rows={9} required defaultValue={editing ? taskLines(editing.tasks as unknown as TaskDef[]) : ""} placeholder={EXAMPLE} className="font-mono text-xs" />
              </Field>
              <SubmitButton pendingText="Saving…">{editing ? "Save changes" : "Create template"}</SubmitButton>
              {editing && <p className="text-xs text-ink-500">Changes apply to work orders raised from now on. Existing work orders keep their checklist.</p>}
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
