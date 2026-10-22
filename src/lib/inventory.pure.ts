/** Spare-parts stock rules (spec §4.8). Pure functions, unit-tested. */

export const MOVE_KINDS = { receipt: "Receipt", issue: "Issued to work order", return: "Returned from work order", transfer_out: "Transfer out", transfer_in: "Transfer in", adjustment: "Adjustment" } as const;
export type MoveKind = keyof typeof MOVE_KINDS;

type Levels = { quantity: number; minQty: number; maxQty: number; reorderPoint: number };

export function stockStatus(s: Levels): "out" | "below_min" | "reorder" | "ok" {
  if (s.quantity <= 0) return "out";
  if (s.minQty > 0 && s.quantity < s.minQty) return "below_min";
  if (s.reorderPoint > 0 && s.quantity <= s.reorderPoint) return "reorder";
  return "ok";
}

/** Quantity to order to bring stock back to max (or to twice the reorder point when no max is set). 0 when not needed. */
export function reorderQty(s: Levels): number {
  const trigger = Math.max(s.reorderPoint, s.minQty);
  if (trigger <= 0 || s.quantity > trigger) return 0;
  const target = s.maxQty > trigger ? s.maxQty : trigger * 2;
  return Math.max(0, Math.ceil(target - s.quantity));
}

/** Parse a positive quantity typed by a user ("1,200" or "2.5"); null when invalid. */
export function parseQty(raw: string, { allowZero = false } = {}): number | null {
  const n = Number(raw.replace(/,/g, "").trim());
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1e9) return null;
  return Math.round(n * 1000) / 1000;
}
