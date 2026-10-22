import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** QR codes encode /a/<token>. Resolve to the passport (scope is enforced there). */
export default async function QrResolve({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cur = await getCurrentUser();
  if (!cur) redirect(`/login?next=${encodeURIComponent(`/a/${token}`)}`);
  const a = await db.asset.findFirst({ where: { qrToken: token, deletedAt: null }, select: { id: true } });
  redirect(a ? `/assets/${a.id}?tab=counter` : `/scan?error=${encodeURIComponent("That QR code does not match any asset.")}`);
}
