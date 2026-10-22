"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/forms";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

/** Withdraw an approved mold–press pair (e.g. after a modification). The pair needs a new PQ to come back. */
export async function revokePairAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  const ret = str(fd, "return") || "/presses/approved";
  if (ctx.isSupplier) back(ret, "Approvals are managed by the organisation.");
  const p = await db.moldPress.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id, status: "approved", mold: assetScope(ctx) }, include: { mold: true, press: true } });
  if (!p) back(ret, "Approved pair not found.");
  const reason = str(fd, "reason");
  if (reason.length < 3) back(ret, "Give a reason for withdrawing the approval.");
  await db.$transaction(async (tx) => {
    await tx.moldPress.update({ where: { id: p.id }, data: { status: "revoked", revokedReason: reason } });
    await audit(ctx, { action: "press_approval_revoked", entityType: "asset", entityId: p.moldId, entityLabel: `${p.mold.number} ${p.mold.name}`, after: { press: p.press.number }, reason }, tx);
  });
  back(ret, `Approval of ${p.mold.number} on ${p.press.number} withdrawn.`, "ok");
}
