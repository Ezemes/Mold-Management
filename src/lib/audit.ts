import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Json = Record<string, unknown>;

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toFixed" in (v as object) && "toNumber" in (v as object)) return (v as { toNumber(): number }).toNumber();
  return v;
}

/** Keep only fields that changed, so each audit row shows a readable before → after. */
export function diff(before: Json | null, after: Json | null) {
  if (!before || !after) return { before: before && clean(before), after: after && clean(after) };
  const b: Json = {};
  const a: Json = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (["updatedAt", "createdAt"].includes(k)) continue;
    const x = plain(before[k]);
    const y = plain(after[k]);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      b[k] = x;
      a[k] = y;
    }
  }
  return { before: b, after: a };
}

function clean(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !["updatedAt", "passwordHash", "otpCode"].includes(k)).map(([k, v]) => [k, plain(v)]));
}

export async function audit(
  ctx: { org: { id: string }; user: { id: string } } | { orgId: string; userId: string | null },
  e: { action: string; entityType: string; entityId?: string; entityLabel?: string; before?: Json | null; after?: Json | null; reason?: string },
  tx: Prisma.TransactionClient = db,
) {
  const orgId = "org" in ctx ? ctx.org.id : ctx.orgId;
  const userId = "user" in ctx ? ctx.user.id : ctx.userId;
  const d = diff(e.before ?? null, e.after ?? null);
  if (e.before && e.after && Object.keys(d.after ?? {}).length === 0) return; // nothing changed
  await tx.auditEvent.create({
    data: {
      orgId,
      userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? "",
      entityLabel: e.entityLabel ?? "",
      before: (d.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (d.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: e.reason ?? "",
    },
  });
}
