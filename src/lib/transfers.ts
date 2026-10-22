import "server-only";
import type { Prisma, Site } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";

export * from "./transfers.pure";

/** Transfers a user may see: those touching a site (or partner) in their scope. */
export function transferScope(ctx: Ctx): Prisma.TransferWhereInput {
  const base = { orgId: ctx.org.id };
  const s = ctx.scope;
  switch (s.type) {
    case "partner":
      return { ...base, OR: [{ fromPartnerId: s.partnerId ?? "__none__" }, { toPartnerId: s.partnerId ?? "__none__" }] };
    case "sites":
      return { ...base, OR: [{ fromSiteId: { in: s.ids } }, { toSiteId: { in: s.ids } }] };
    case "divisions":
      return { ...base, OR: [{ fromSite: { divisionId: { in: s.ids } } }, { toSite: { divisionId: { in: s.ids } } }] };
    default:
      return base;
  }
}

/** Can this user act for the party holding (or receiving at) `site`? */
export function actsFor(ctx: Ctx, site: Pick<Site, "id" | "partnerId" | "divisionId">) {
  const s = ctx.scope;
  if (s.type === "partner") return !!s.partnerId && site.partnerId === s.partnerId;
  if (s.type === "sites") return s.ids.includes(site.id);
  if (s.type === "divisions") return !!site.divisionId && s.ids.includes(site.divisionId);
  return true;
}

export async function nextTransferNumber(tx: Prisma.TransactionClient, orgId: string) {
  const rows = await tx.transfer.findMany({ where: { orgId }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number.replace(/^T-/, ""), 10) || 0), 0);
  return `T-${String(max + 1).padStart(4, "0")}`;
}

export async function openTransferFor(assetIds: string[], excludeTransferId?: string) {
  return db.transferItem.findFirst({
    where: { assetId: { in: assetIds }, transfer: { status: { in: ["draft", "requested", "approved", "in_transit", "disputed"] }, ...(excludeTransferId ? { NOT: { id: excludeTransferId } } : {}) } },
    include: { asset: true, transfer: true },
  });
}
