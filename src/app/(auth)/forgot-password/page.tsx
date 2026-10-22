import Link from "next/link";
import { FlashFromParams, Field, Input, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Forgot password" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; dev?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-ink-500">Enter your email and we will send you a reset link.</p>
      <FlashFromParams params={sp} />
      {sp.dev && (
        <Notice tone="warn">
          Development mode: no email provider is configured.{" "}
          <Link className="font-medium underline" href={`/reset-password?token=${sp.dev}`}>Open the reset link</Link>
        </Notice>
      )}
      <form action={forgotPasswordAction} className="space-y-4">
        <Field label="Email" name="email"><Input name="email" type="email" required /></Field>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></p>
    </>
  );
}
