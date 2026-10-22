import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveRoleAction } from "../actions";
import { RoleMatrix } from "../role-matrix";

export const metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["roles", "view"]);
  const roles = await db.role.findMany({ where: { orgId: ctx.org.id }, include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader title="Roles" subtitle="A role grants actions per module. Built-in roles are fixed; create custom roles for anything else." />
      <FlashFromParams params={sp} />
      <Table head={["Role", "Description", "Users", ""]}>
        {roles.map((r) => (
          <tr key={r.id} className="hover:bg-gray-50">
            <Td><Link href={`/admin/roles/${r.id}`} className="font-medium hover:text-brand-700">{r.name}</Link></Td>
            <Td className="text-xs text-ink-700">{r.description}</Td>
            <Td>{r._count.memberships}</Td>
            <Td className="space-x-1">{r.key ? <Badge color="gray">built-in</Badge> : <Badge color="brand">custom</Badge>}{r.isSupplier && <Badge color="blue">supplier</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {ctx.can("roles", "create") && (
        <Card title="New custom role" className="mt-6">
          <form action={saveRoleAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input name="name" required /></Field>
              <Field label="Description" className="sm:col-span-2"><Input name="description" /></Field>
              <Field label="Kind" hint="Supplier roles are limited to one partner's molds."><Select name="isSupplier" options={{ "0": "Internal", "1": "Supplier" }} /></Field>
            </div>
            <RoleMatrix perms={{}} />
            <SubmitButton>Create role</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
