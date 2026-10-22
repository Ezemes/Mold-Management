import Link from "next/link";
import { FlashFromParams, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { INDIAN_STATES } from "@/lib/india";
import { registerAction } from "../actions";

export const metadata = { title: "Register" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Register your organisation</h1>
      <p className="mb-6 text-sm text-ink-500">You will be the organisation admin. You can add plants, partners and users afterwards.</p>
      <FlashFromParams params={sp} />
      <form action={registerAction} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" name="first_name"><Input name="first_name" required /></Field>
          <Field label="Last name" name="last_name"><Input name="last_name" /></Field>
        </div>
        <Field label="Work email" name="email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Mobile (optional)" name="phone"><Input name="phone" type="tel" placeholder="+91" /></Field>
        <Field label="Password" name="password" hint="10+ characters, including a letter and a number.">
          <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Organisation name" name="org_name"><Input name="org_name" required /></Field>
        <Field label="Your first plant" name="site_name" hint="e.g. Pune Plant 1"><Input name="site_name" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" name="city"><Input name="city" /></Field>
          <Field label="State" name="state"><Select name="state" options={INDIAN_STATES.map((s) => [s, s] as [string, string])} placeholder="—" /></Field>
        </div>
        <SubmitButton className="w-full" pendingText="Creating…">Create organisation</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-ink-500">Already registered? <Link href="/login" className="text-brand-700 hover:underline">Sign in</Link></p>
    </>
  );
}
