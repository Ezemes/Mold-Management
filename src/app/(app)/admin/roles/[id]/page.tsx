import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { rolePermissions } from "@/lib/permissions";
import { Field, FlashFromParams, Input, Notice, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { deleteRoleAction, saveRoleAction } from "../../actions";
import { RoleMatrix } from "../../role-matrix";

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["roles", "view"]);
  const r = await db.role.findFirst({ where: { id, orgId: ctx.org.id } });
  if (!r) notFound();
  const locked = !!r.key || !ctx.can("roles", "edit");
  return (
    <>
      <PageHeader back={{ href: "/admin/roles", label: "Roles" }} title={r.name} subtitle={r.description} />
      <FlashFromParams params={sp} />
      {r.key && <Notice tone="info">Built-in roles cannot be edited. Create a custom role with the permissions you need.</Notice>}
      <form action={saveRoleAction} className="space-y-4">
        <input type="hidden" name="id" value={r.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><Input name="name" defaultValue={r.name} disabled={locked} required /></Field>
          <Field label="Description" className="sm:col-span-2"><Input name="description" defaultValue={r.description} disabled={locked} /></Field>
          <Field label="Kind"><Select name="isSupplier" defaultValue={r.isSupplier ? "1" : "0"} options={{ "0": "Internal", "1": "Supplier" }} disabled={locked} /></Field>
        </div>
        <RoleMatrix perms={rolePermissions(r)} disabled={locked} />
        {!locked && <SubmitButton>Save role</SubmitButton>}
      </form>
      {!r.key && ctx.can("roles", "delete") && (
        <form action={deleteRoleAction} className="mt-6"><input type="hidden" name="id" value={r.id} /><SubmitButton variant="danger" confirm="Delete this role?">Delete role</SubmitButton></form>
      )}
    </>
  );
}
