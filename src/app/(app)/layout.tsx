import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { OrgSwitcher, Shell, UserMenu, type NavItem } from "@/components/shell";
import { Badge } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const memberships = await db.membership.findMany({ where: { userId: ctx.user.id, status: "active" }, include: { org: true } });
  const orgs = memberships.map((m) => ({ id: m.org.id, name: m.org.name }));
  const unread = await db.notification.count({ where: { userId: ctx.user.id, orgId: ctx.org.id, readAt: null } });
  const maintCount = ctx.can("maintenance") ? await db.notification.count({ where: { userId: ctx.user.id, orgId: ctx.org.id, readAt: null, kind: { in: ["pm_due", "wo_assigned", "wo_overdue"] } } }) : 0;
  const actionCount = ctx.can("transfers") ? await db.notification.count({ where: { userId: ctx.user.id, orgId: ctx.org.id, readAt: null, kind: { startsWith: "transfer_" } } }) : 0;

  const nav: { title?: string; items: NavItem[] }[] = ctx.isSupplier
    ? [{ items: [{ href: "/dashboard", label: "Home" }, { href: "/assets", label: "My molds" }, { href: "/transfers", label: "Transfers", badge: actionCount }, { href: "/maintenance", label: "Maintenance", badge: maintCount }, ...(ctx.can("quality") ? [{ href: "/quality", label: "Quality" }] : []), { href: "/scan", label: "Scan QR" }] }]
    : [
        { items: [{ href: "/dashboard", label: "Dashboard" }] },
        {
          title: "Fleet",
          items: [
            { href: "/assets", label: "Assets" },
            ...(ctx.can("transfers") ? [{ href: "/transfers", label: "Transfers", badge: actionCount }] : []),
            ...(ctx.can("maintenance") ? [{ href: "/maintenance", label: "Maintenance", badge: maintCount }] : []),
            ...(ctx.can("readings") ? [{ href: "/reconciliation", label: "Reconciliation" }] : []),
            { href: "/presses", label: "Presses" },
            ...(ctx.can("quality") ? [{ href: "/quality", label: "Quality" }] : []),
            ...(ctx.can("inventory") ? [{ href: "/inventory", label: "Spare parts" }] : []),
            { href: "/scan", label: "Scan QR" },
            ...(ctx.can("import_export") ? [{ href: "/import-export", label: "Import & export" }] : []),
          ],
        },
        ...(ctx.can("planning") || ctx.can("reports")
          ? [{
              title: "Planning",
              items: [
                ...(ctx.can("planning") ? [{ href: "/planning/forecast", label: "Life forecast" }, { href: "/planning/capacity", label: "Capacity" }, { href: "/planning/budget", label: "Budget" }] : []),
                ...(ctx.can("reports") ? [{ href: "/reports", label: "Reports" }] : []),
              ],
            }]
          : []),
        {
          title: "Admin",
          items: [
            ...(ctx.can("sites") ? [{ href: "/admin/sites", label: "Sites & divisions" }] : []),
            ...(ctx.can("partners") ? [{ href: "/admin/partners", label: "Partners" }] : []),
            ...(ctx.can("asset_types") ? [{ href: "/admin/asset-types", label: "Asset types & fields" }] : []),
            ...(ctx.can("users") ? [{ href: "/admin/users", label: "Users" }] : []),
            ...(ctx.can("roles") ? [{ href: "/admin/roles", label: "Roles" }] : []),
            ...(ctx.can("audit") ? [{ href: "/admin/audit", label: "Audit log" }] : []),
            ...(ctx.can("settings") ? [{ href: "/admin/settings", label: "Settings" }] : []),
            ...(ctx.can("integrations") ? [{ href: "/admin/integrations", label: "Integrations" }] : []),
          ],
        },
      ].filter((g) => g.items.length);

  return (
    <Shell
      nav={nav}
      heading={
        <div className="space-y-1">
          <OrgSwitcher current={{ id: ctx.org.id, name: ctx.org.name }} options={orgs} />
          <div className="flex flex-wrap gap-1">
            <Badge color="gray">{ctx.role.name}</Badge>
            {ctx.membership.partner && <Badge color="brand">{ctx.membership.partner.name}</Badge>}
          </div>
        </div>
      }
      topRight={
        <>
          <form action="/assets" className="hidden sm:block">
            <input name="q" placeholder="Search assets…" className="w-56 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white" />
          </form>
          <Link href="/notifications" className="relative rounded-md px-2 py-1 text-sm text-ink-700 hover:bg-gray-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            Alerts{unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
          </Link>
          <UserMenu name={`${ctx.user.firstName} ${ctx.user.lastName}`.trim()} email={ctx.user.email} links={[{ href: "/profile", label: "Profile" }]} />
        </>
      }
    >
      {children}
    </Shell>
  );
}
