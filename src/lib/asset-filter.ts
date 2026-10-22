import type { Prisma } from "@prisma/client";

export type AssetFilterParams = { q?: string; type?: string; site?: string; custodian?: string; status?: string };

export function assetFilter(sp: AssetFilterParams): Prisma.AssetWhereInput {
  const q = sp.q?.trim();
  return {
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { toolNumber: { contains: q, mode: "insensitive" } }, { program: { contains: q, mode: "insensitive" } }, { products: { some: { partNumber: { contains: q, mode: "insensitive" } } } }] } : {}),
    ...(sp.type ? { assetTypeId: sp.type } : {}),
    ...(sp.site ? { siteId: sp.site } : {}),
    ...(sp.custodian === "own" ? { custodianPartnerId: null } : sp.custodian ? { custodianPartnerId: sp.custodian } : {}),
    ...(sp.status ? { status: sp.status } : {}),
  };
}
