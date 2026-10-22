import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Card, Field, FlashFromParams, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { removeMemberAction, updateMemberAction } from "../../actions";
import { AccessFields } from "../../access-fields";

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["users", "view"]);
  const oid = ctx.org.id;
  const m = await db.membership.findFirst({ where: { id, orgId: oid }, include: { user: true } });
  if (!m) notFound();
  const [roles, sites, divisions, partners] = await Promise.all([
    db.role.findMany({ where: { orgId: oid }, orderBy: { createdAt: "asc" } }),
    db.site.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
    db.division.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: oid }, orderBy: { name: "asc" } }),
  ]);
  const editable = ctx.can("users", "edit");
  return (
    <>
      <PageHeader back={{ href: "/admin/users", label: "Users" }} title={`${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email} subtitle={`${m.user.email} · last sign-in ${fmtDateTime(m.user.lastLoginAt, ctx.org.timezone)}`} />
      <FlashFromParams params={sp} />
      <Card title="Access">
        <form action={updateMemberAction} className="space-y-4">
          <input type="hidden" name="id" value={m.id} />
          <AccessFields roles={roles} sites={sites} divisions={divisions} partners={partners} value={m} />
          <Field label="Status"><Select name="status" defaultValue={m.status} options={{ active: "Active", suspended: "Suspended" }} /></Field>
          {editable && <SubmitButton>Save access</SubmitButton>}
        </form>
      </Card>
      {ctx.can("users", "delete") && m.userId !== ctx.user.id && (
        <form action={removeMemberAction} className="mt-6">
          <input type="hidden" name="id" value={m.id} />
          <SubmitButton variant="danger" confirm={`Remove ${m.user.email} from ${ctx.org.name}?`}>Remove from organisation</SubmitButton>
        </form>
      )}
    </>
  );
}
