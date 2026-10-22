import "server-only";
import { db } from "./db";

/** Next free asset number for a prefix, e.g. M-0042. */
export async function nextNumber(orgId: string, prefix: string) {
  const rows = await db.asset.findMany({ where: { orgId, number: { startsWith: prefix } }, select: { number: true } });
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.number.slice(prefix.length), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
