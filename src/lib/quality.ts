import "server-only";
import type { Prisma } from "@prisma/client";
import { audit } from "./audit";
import { DEFAULT_MOLD_CRITERIA, type Criterion } from "./quality.pure";

export * from "./quality.pure";

/** An asset type's evaluation criteria; molds fall back to the standard list until an admin edits it. */
export function criteriaFor(type: { kind: string; evalCriteria: unknown }): Criterion[] {
  const c = (Array.isArray(type.evalCriteria) ? type.evalCriteria : []) as Criterion[];
  if (c.length) return c;
  return type.kind === "mold" ? DEFAULT_MOLD_CRITERIA : [{ key: "general", label: "General condition", weight: 1 }];
}

export async function nextQualificationNumber(tx: Prisma.TransactionClient, orgId: string) {
  const rows = await tx.qualification.findMany({ where: { orgId }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number.replace(/^Q-/, ""), 10) || 0), 0);
  return `Q-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Mark a mold as needing re-qualification (after a move to another site or a major modification).
 * A modification also withdraws its approved press pairs, since the proven process no longer applies.
 */
export async function flagRequalification(
  tx: Prisma.TransactionClient,
  who: { orgId: string; userId: string | null },
  asset: { id: string; number: string; name: string },
  reason: string,
  opts: { revokePairs?: boolean } = {},
) {
  await tx.asset.update({ where: { id: asset.id }, data: { requalificationReason: reason } });
  let revoked = 0;
  if (opts.revokePairs) revoked = (await tx.moldPress.updateMany({ where: { moldId: asset.id, status: "approved" }, data: { status: "revoked", revokedReason: reason } })).count;
  await audit(who, { action: "requalification_required", entityType: "asset", entityId: asset.id, entityLabel: `${asset.number} ${asset.name}`, after: { revokedPairs: revoked }, reason }, tx);
}
