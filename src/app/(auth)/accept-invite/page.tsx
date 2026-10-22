import { db } from "@/lib/db";
import { FlashFromParams, Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { acceptInviteAction } from "../actions";

export const metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const inv = sp.token ? await db.invite.findUnique({ where: { token: sp.token }, include: { org: true, role: true, partner: true } }) : null;
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) {
    return <Notice tone="error">This invitation is invalid, already used or expired. Ask your administrator for a new one.</Notice>;
  }
  const existing = await db.user.findUnique({ where: { email: inv.email } });
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Join {inv.org.name}</h1>
      <p className="mb-6 text-sm text-ink-500">
        You were invited as <strong>{inv.role.name}</strong>{inv.partner && <> for <strong>{inv.partner.name}</strong></>} ({inv.email}).
      </p>
      <FlashFromParams params={sp} />
      <form action={acceptInviteAction} className="space-y-4">
        <input type="hidden" name="token" value={inv.token} />
        {!existing && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" name="first_name"><Input name="first_name" required /></Field>
              <Field label="Last name" name="last_name"><Input name="last_name" /></Field>
            </div>
            <Field label="Password" name="password" hint="10+ characters, including a letter and a number."><Input name="password" type="password" required minLength={10} /></Field>
          </>
        )}
        <SubmitButton className="w-full">Accept invitation</SubmitButton>
      </form>
    </>
  );
}
