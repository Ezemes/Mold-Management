import type { Prisma } from "@prisma/client";
import { BUILTIN_ROLES } from "./permissions";
import { DEFAULT_TYPES } from "./assets";

/** Create an organisation with built-in roles, default asset types and a first site; returns the admin role. */
export async function setupOrganisation(tx: Prisma.TransactionClient, args: { name: string; siteName: string; city?: string; state?: string }) {
  const org = await tx.organisation.create({ data: { name: args.name } });
  for (const r of BUILTIN_ROLES) {
    await tx.role.create({ data: { orgId: org.id, key: r.key, name: r.name, description: r.description, isSupplier: r.isSupplier, permissions: r.permissions as Prisma.InputJsonValue } });
  }
  for (const t of DEFAULT_TYPES) {
    await tx.assetType.create({ data: { orgId: org.id, key: t.key, name: t.name, kind: t.kind, numberPrefix: t.numberPrefix, description: t.description, features: t.features } });
  }
  await tx.site.create({ data: { orgId: org.id, name: args.siteName, kind: "plant", city: args.city ?? "", state: args.state ?? "" } });
  const admin = await tx.role.findFirstOrThrow({ where: { orgId: org.id, key: "org_admin" } });
  return { org, adminRole: admin };
}
