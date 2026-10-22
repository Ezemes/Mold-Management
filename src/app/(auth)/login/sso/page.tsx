import Link from "next/link";
import { Field, FlashFromParams, Input } from "@/components/ui";

export const metadata = { title: "Single sign-on" };

export default async function SsoLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in with single sign-on</h1>
      <p className="mb-6 text-sm text-ink-500">Enter your work email. We&apos;ll send you to your organisation&apos;s sign-in page.</p>
      <FlashFromParams params={{ error: sp.error }} />
      <form action="/api/sso/start" method="get" className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Work email" name="email"><Input name="email" type="email" required autoComplete="email" defaultValue={sp.email ?? ""} /></Field>
        <button className="w-full rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Continue</button>
      </form>
      <p className="mt-6 text-sm"><Link href="/login" className="text-brand-700 hover:underline">Sign in with a password instead</Link></p>
    </>
  );
}
