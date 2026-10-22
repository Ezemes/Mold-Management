import "server-only";
import { Prisma } from "@prisma/client";
import type { MoveKind } from "./inventory.pure";

export * from "./inventory.pure";

export class StockError extends Error {}

/**
 * Change the stock of one part at one site and record it in the ledger. The quantity update is a single
 * conditional UPDATE, so concurrent issues can never take stock below zero.
 */
export async function moveStock(
  tx: Prisma.TransactionClient,
  m: { orgId: string; partId: string; siteId: string; kind: MoveKind; quantity: number; unitCost?: number; workOrderId?: string | null; reference?: string; note?: string; userId: string; expiresAt?: Date | null },
) {
  const part = await tx.part.findUniqueOrThrow({ where: { id: m.partId } });
  const stock = await tx.stock.upsert({
    where: { partId_siteId: { partId: m.partId, siteId: m.siteId } },
    create: { partId: m.partId, siteId: m.siteId, minQty: part.minQty, maxQty: part.maxQty, reorderPoint: part.reorderPoint },
    update: {},
  });
  const rows = await tx.$queryRaw<{ quantity: number }[]>(
    Prisma.sql`UPDATE "Stock" SET quantity = quantity + ${m.quantity}, "updatedAt" = now() WHERE id = ${stock.id} AND quantity + ${m.quantity} >= 0 RETURNING quantity`,
  );
  if (!rows.length) throw new StockError(`Only ${stock.quantity.toLocaleString("en-IN")} ${part.unit} of ${part.number} in stock at this site.`);
  return tx.stockMove.create({
    data: {
      orgId: m.orgId, partId: m.partId, siteId: m.siteId, kind: m.kind, quantity: m.quantity, balanceAfter: rows[0].quantity, unitCost: m.unitCost ?? Number(part.unitCost),
      workOrderId: m.workOrderId ?? null, reference: m.reference ?? "", note: m.note ?? "", userId: m.userId, expiresAt: m.expiresAt ?? null,
    },
  });
}
