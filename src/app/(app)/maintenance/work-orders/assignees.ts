import "server-only";
import { db } from "@/lib/db";
import { can, rolePermissions } from "@/lib/permissions";

/** People who can work on maintenance, plus partner companies, as "u:<id>" / "p:<id>" options. */
export async function assigneeOptions(orgId: string): Promise<[string, string][]> {
  const [ms, partners] = await Promise.all([
    db.membership.findMany({ where: { orgId, status: "active", user: { status: "active" } }, include: { user: true, role: true }, orderBy: { user: { firstName: "asc" } } }),
    db.partner.findMany({ where: { orgId, status: "active" }, orderBy: { name: "asc" } }),
  ]);
  return [
    ...ms.filter((m) => !m.role.isSupplier && can(rolePermissions(m.role), "maintenance", "edit")).map((m) => [`u:${m.userId}`, `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email] as [string, string]),
    ...partners.map((p) => [`p:${p.id}`, `${p.name} (company)`] as [string, string]),
  ];
}
