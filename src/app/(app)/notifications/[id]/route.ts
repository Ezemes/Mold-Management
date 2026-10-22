import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";

/** Open a notification: mark it read, then go to what it points at (same-site paths only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const n = await db.notification.findFirst({ where: { id, userId: ctx.user.id, orgId: ctx.org.id } });
  if (!n) redirect("/notifications");
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  redirect(n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications");
}
