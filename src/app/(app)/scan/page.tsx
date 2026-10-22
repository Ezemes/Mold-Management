import { requireOrg } from "@/lib/auth";
import { Card, FlashFromParams, PageHeader } from "@/components/ui";
import { Scanner } from "./scanner";
import { findByNumberAction } from "./actions";

export const metadata = { title: "Scan" };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  await requireOrg(["assets", "view"]);
  return (
    <>
      <PageHeader title="Scan a QR tag" subtitle="Point your phone camera at the mold's tag, or type the asset number." />
      <FlashFromParams params={sp} />
      <div className="mx-auto max-w-md space-y-4">
        <Scanner />
        <Card title="Or enter the asset number">
          <form action={findByNumberAction} className="flex gap-2">
            <input name="number" required placeholder="M-0001" className="input" autoCapitalize="characters" />
            <button className="rounded-md bg-brand-600 px-4 text-sm font-medium text-white">Open</button>
          </form>
        </Card>
      </div>
    </>
  );
}
