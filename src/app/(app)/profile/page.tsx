import { requireOrg } from "@/lib/auth";
import { Card, Field, FlashFromParams, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { changePasswordAction, updateProfileAction } from "./actions";

export const metadata = { title: "Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  return (
    <>
      <PageHeader title="Your profile" subtitle={`${ctx.user.email} · ${ctx.role.name} at ${ctx.org.name}`} />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <form action={updateProfileAction} className="space-y-3">
            <Field label="First name"><Input name="first_name" defaultValue={ctx.user.firstName} /></Field>
            <Field label="Last name"><Input name="last_name" defaultValue={ctx.user.lastName} /></Field>
            <Field label="Mobile"><Input name="phone" type="tel" defaultValue={ctx.user.phone} /></Field>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>
        <Card title="Change password">
          <form action={changePasswordAction} className="space-y-3">
            <Field label="Current password"><Input type="password" name="current_password" required autoComplete="current-password" /></Field>
            <Field label="New password" hint="10+ characters, including a letter and a number."><Input type="password" name="new_password" required minLength={10} autoComplete="new-password" /></Field>
            <SubmitButton>Change password</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
