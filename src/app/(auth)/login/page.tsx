import Link from "next/link";
import { FlashFromParams, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-ink-500">Your molds, wherever they are.</p>
      <FlashFromParams params={sp} />
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field label="Email" name="email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" name="password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-brand-700 hover:underline">Register your organisation</Link>
      </div>
    </>
  );
}
