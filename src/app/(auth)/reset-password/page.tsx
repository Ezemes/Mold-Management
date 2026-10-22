import { FlashFromParams, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-lg font-semibold">Choose a new password</h1>
      <FlashFromParams params={sp} />
      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <Field label="New password" name="password" hint="10+ characters, including a letter and a number.">
          <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full">Update password</SubmitButton>
      </form>
    </>
  );
}
