import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { WO_PRIORITY, WO_TYPES } from "@/lib/work-orders";
import { Card, Field, FlashFromParams, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createWorkOrderAction } from "../../actions";
import { assigneeOptions } from "../assignees";

export const metadata = { title: "New work order" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ asset?: string; type?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "create"]);
  const [templates, assignees] = await Promise.all([
    db.maintenanceTemplate.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: "asc" } }),
    ctx.isSupplier ? Promise.resolve([]) : assigneeOptions(ctx.org.id),
  ]);
  return (
    <>
      <PageHeader title="New work order" back={{ href: "/maintenance", label: "Maintenance" }} />
      <FlashFromParams params={sp} />
      <Card className="max-w-2xl">
        <form action={createWorkOrderAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset number" name="asset">
            <Input name="asset" required defaultValue={sp.asset ?? ""} placeholder="e.g. MLD-0001" />
          </Field>
          <Field label="Type" name="type">
            <Select name="type" options={WO_TYPES} defaultValue={sp.type && sp.type in WO_TYPES ? sp.type : "corrective"} />
          </Field>
          <Field label="Title" name="title" className="sm:col-span-2">
            <Input name="title" required maxLength={200} placeholder="e.g. Flash on cavity 3 parting line" />
          </Field>
          <Field label="Description" name="description" className="sm:col-span-2">
            <Textarea name="description" rows={4} />
          </Field>
          <Field label="Checklist template" name="templateId" hint="Optional. Copies the template's tasks into this work order.">
            <Select name="templateId" placeholder="No checklist" options={templates.map((t) => [t.id, t.name] as [string, string])} />
          </Field>
          <Field label="Priority" name="priority">
            <Select name="priority" options={WO_PRIORITY} defaultValue="medium" />
          </Field>
          <Field label="Due date" name="dueDate" hint="DD-MM-YYYY">
            <Input name="dueDate" placeholder="DD-MM-YYYY" />
          </Field>
          {!ctx.isSupplier && (
            <Field label="Assign to" name="assignee">
              <Select name="assignee" placeholder="Unassigned" options={assignees} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Creating…">Create work order</SubmitButton>
          </div>
        </form>
      </Card>
    </>
  );
}
