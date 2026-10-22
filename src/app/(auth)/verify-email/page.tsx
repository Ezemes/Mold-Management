import { db } from "@/lib/db";
import { showDevSecrets } from "@/lib/mail";
import { FlashFromParams, Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { resendOtpAction, verifyOtpAction } from "../actions";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const email = sp.email ?? "";
  const devCode = showDevSecrets && email ? (await db.user.findUnique({ where: { email } }))?.otpCode : null;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Check your email</h1>
      <p className="mb-6 text-sm text-ink-500">We sent a 6-digit code to <strong>{email}</strong>.</p>
      <FlashFromParams params={sp} />
      {devCode && <Notice tone="warn">Development mode: no email provider is configured. Your code is <strong>{devCode}</strong>.</Notice>}
      <form action={verifyOtpAction} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <Field label="Verification code" name="code"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" /></Field>
        <SubmitButton className="w-full">Verify and continue</SubmitButton>
      </form>
      <form action={resendOtpAction} className="mt-4 text-center">
        <input type="hidden" name="email" value={email} />
        <SubmitButton variant="ghost" size="sm">Resend code</SubmitButton>
      </form>
    </>
  );
}
