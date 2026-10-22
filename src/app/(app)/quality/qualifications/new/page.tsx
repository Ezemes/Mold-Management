import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { can, rolePermissions } from "@/lib/permissions";
import { QUAL_STAGES, STAGE_NAMES } from "@/lib/quality";
import { Card, Field, FlashFromParams, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createQualificationAction } from "../../actions";

export const metadata = { title: "New qualification" };

export default async function NewQualificationPage({ searchParams }: { searchParams: Promise<{ asset?: string; press?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "create"]);
  const ms = await db.membership.findMany({ where: { orgId: ctx.org.id, status: "active", user: { status: "active" } }, include: { user: true, role: true } });
  const owners = ms.filter((m) => !m.role.isSupplier && can(rolePermissions(m.role), "quality", "edit")).map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`] as [string, string]);
  return (
    <>
      <PageHeader title="New qualification" back={{ href: "/quality/qualifications", label: "Qualifications" }} subtitle="Name the press to approve the mold–press pair when PQ passes. The press must pass the compatibility rules." />
      <FlashFromParams params={sp} />
      <Card className="max-w-3xl">
        <form action={createQualificationAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Mold number" name="asset"><Input name="asset" required defaultValue={sp.asset ?? ""} placeholder="M-0001" /></Field>
          <Field label="Press number" name="press" hint="Optional. Leave blank to qualify the mold alone."><Input name="press" defaultValue={sp.press ?? ""} placeholder="P-0001" /></Field>
          <Field label="Kind" name="kind"><Select name="kind" options={{ initial: "Initial", requalification: "Re-qualification" }} /></Field>
          <Field label="Reason" name="reason"><Input name="reason" placeholder="e.g. new mold, moved to Chennai" /></Field>
          <div className="sm:col-span-2">
            <p className="label">Stages</p>
            <div className="space-y-2">
              {QUAL_STAGES.map((s) => (
                <div key={s} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_1fr]">
                  <span className="text-sm font-medium">{STAGE_NAMES[s]}</span>
                  <Select name={`${s}.owner`} placeholder="Owner" options={owners} aria-label={`${s} owner`} />
                  <Input name={`${s}.planned`} placeholder="Planned date DD-MM-YYYY" aria-label={`${s} planned date`} />
                </div>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2"><SubmitButton pendingText="Starting…">Start qualification</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}
