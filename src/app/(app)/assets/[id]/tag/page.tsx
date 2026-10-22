import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireOrg } from "@/lib/auth";
import { loadPassport, custodianName } from "@/lib/passport";
import { appUrl } from "@/lib/mail";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";

export default async function TagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg(["assets", "view"]);
  const p = await loadPassport(ctx, id);
  if (!p) notFound();
  const a = p.asset;
  const url = appUrl(`/a/${a.qrToken}`);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <>
      <div className="no-print">
        <PageHeader back={{ href: `/assets/${a.id}`, label: a.number }} title="QR tag" subtitle="Print and fix to the mold. Scanning opens this asset's shot-counter page." actions={<PrintButton />} />
      </div>
      <div className="mx-auto w-[90mm] rounded-lg border-2 border-ink-900 bg-white p-4 text-center print:border">
        <div className="mx-auto w-[60mm]" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-2 font-mono text-xl font-bold">{a.number}</p>
        <p className="text-sm">{a.name}</p>
        <p className="mt-1 text-xs text-ink-500">{ctx.org.name} · {custodianName(a, ctx.org.name)}</p>
      </div>
      <p className="no-print mt-4 text-center text-xs text-ink-500">{url}</p>
    </>
  );
}
