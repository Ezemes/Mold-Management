"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";

export async function markAllReadAction() {
  const ctx = await requireOrg();
  const n = await db.notification.updateMany({ where: { userId: ctx.user.id, orgId: ctx.org.id, readAt: null }, data: { readAt: new Date() } });
  redirect(`/notifications?ok=${encodeURIComponent(`${n.count} marked as read.`)}`);
}
