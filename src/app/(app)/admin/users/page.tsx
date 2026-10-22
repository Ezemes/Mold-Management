import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { inviteUserAction, revokeInviteAction } from "../actions";
import { AccessFields } from "../access-fields";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["users", "view"]);
  const oid = ctx.org.id;
  const [members, invites, roles, sites, divisions, partners] = await Promise.all([
    db.membership.findMany({ where: { orgId: oid }, include: { user: true, role: true, partner: true }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { orgId: oid, status: "pending" }, include: { role: true, partner: true }, orderBy: { createdAt: "desc" } }),
    db.role.findMany({ where: { orgId: oid }, orderBy: { createdAt: "asc" } }),
    db.site.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
    db.division.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: oid, status: "active" }, orderBy: { name: "asc" } }),
  ]);
  const scopeLabel = (m: { scopeType: string; scopeIds: string[]; partner?: { name: string } | null }) =>
    m.partner ? `Partner: ${m.partner.name}` : m.scopeType === "all" ? "Whole organisation" : `${m.scopeIds.length} ${m.scopeType}`;
  return (
    <>
      <PageHeader title="Users" subtitle="Each person has one role and a data scope in this organisation." />
      <FlashFromParams params={sp} />
      {ctx.can("users", "create") && (
        <Card title="Invite a user" className="mb-6">
          <form action={inviteUserAction} className="space-y-4">
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <AccessFields roles={roles} sites={sites} divisions={divisions} partners={partners} value={{ roleId: roles.find((r) => r.key === "technician")?.id }} />
            <SubmitButton>Send invitation</SubmitButton>
          </form>
        </Card>
      )}
      <Table head={["User", "Role", "Scope", "Last sign-in", "Status"]}>
        {members.map((m) => (
          <tr key={m.id} className="hover:bg-gray-50">
            <Td><Link href={`/admin/users/${m.id}`} className="font-medium hover:text-brand-700">{`${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email}</Link><p className="text-xs text-ink-500">{m.user.email}</p></Td>
            <Td>{m.role.name}</Td>
            <Td className="text-xs text-ink-700">{scopeLabel(m)}</Td>
            <Td className="text-xs text-ink-500">{fmtDate(m.user.lastLoginAt, ctx.org.timezone)}</Td>
            <Td><Badge status={m.status} /></Td>
          </tr>
        ))}
      </Table>
      <h2 className="mb-2 mt-8 text-sm font-semibold">Pending invitations</h2>
      <Table head={["Email", "Role", "Scope", "Expires", ""]} empty="No pending invitations.">
        {invites.map((i) => (
          <tr key={i.id}>
            <Td>{i.email}</Td><Td>{i.role.name}</Td><Td className="text-xs">{scopeLabel(i)}</Td>
            <Td className="text-xs text-ink-500">{fmtDate(i.expiresAt, ctx.org.timezone)}</Td>
            <Td>{ctx.can("users", "delete") && <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><SubmitButton size="sm" variant="ghost">Revoke</SubmitButton></form>}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
