import { requireUser } from "@/lib/auth";
import { FlashFromParams, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createOrgAction } from "../actions";

export const metadata = { title: "Set up your organisation" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const { user } = await requireUser();
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Welcome{user.firstName ? `, ${user.firstName}` : ""}</h1>
      <p className="mb-6 text-sm text-ink-500">You are not part of an organisation yet. Create one, or ask your administrator for an invitation.</p>
      <FlashFromParams params={sp} />
      <form action={createOrgAction} className="space-y-4">
        <Field label="Organisation name" name="org_name"><Input name="org_name" required /></Field>
        <Field label="First plant" name="site_name"><Input name="site_name" required /></Field>
        <SubmitButton className="w-full">Create organisation</SubmitButton>
      </form>
    </>
  );
}
