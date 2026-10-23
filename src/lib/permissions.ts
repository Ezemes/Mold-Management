/** Modules and actions that roles grant. Phase 3b+ modules are added here as they ship. */
export const MODULES = {
  assets: "Assets & passports",
  readings: "Shot readings",
  documents: "Documents",
  transfers: "Transfers & handovers",
  maintenance: "Maintenance & work orders",
  downtime: "Downtime",
  quality: "Condition & qualification",
  inventory: "Spare parts & stock",
  planning: "Budget & capacity planning",
  reports: "Reports",
  asset_types: "Asset types & custom fields",
  sites: "Divisions & sites",
  partners: "Partner organisations",
  users: "Users & invitations",
  roles: "Roles",
  audit: "Audit log",
  import_export: "Import & export",
  settings: "Organisation settings",
  integrations: "API keys, webhooks & SSO",
} as const;
export type Module = keyof typeof MODULES;

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type Action = (typeof ACTIONS)[number];

export type Permissions = Partial<Record<Module, Action[]>>;

const ALL: Action[] = [...ACTIONS];
const VIEW: Action[] = ["view"];
const CRUD: Action[] = ["view", "create", "edit", "delete"];

type BuiltinRole = { key: string; name: string; description: string; isSupplier: boolean; permissions: Permissions };

export const BUILTIN_ROLES: BuiltinRole[] = [
  {
    key: "org_admin",
    name: "Org Admin",
    description: "Full access, including users, roles, settings and the audit log.",
    isSupplier: false,
    permissions: Object.fromEntries(Object.keys(MODULES).map((m) => [m, ALL])) as Permissions,
  },
  {
    key: "tooling_manager",
    name: "Tooling Manager",
    description: "Manages the mold fleet: passports, readings, documents and imports.",
    isSupplier: false,
    permissions: { assets: CRUD, readings: CRUD, documents: CRUD, transfers: ALL, maintenance: ALL, downtime: ALL, quality: ALL, inventory: ALL, planning: CRUD, reports: VIEW, asset_types: VIEW, sites: VIEW, partners: VIEW, import_export: ["view", "create"], audit: VIEW },
  },
  {
    key: "planner",
    name: "Planner",
    description: "Views the fleet and its history to plan production and capacity.",
    isSupplier: false,
    permissions: { assets: VIEW, readings: VIEW, documents: VIEW, transfers: ["view", "create"], maintenance: VIEW, downtime: VIEW, quality: VIEW, inventory: VIEW, planning: ALL, reports: VIEW, sites: VIEW, partners: VIEW, import_export: VIEW },
  },
  {
    key: "quality_engineer",
    name: "Quality Engineer",
    description: "Edits passports and manages documents such as trial and qualification reports.",
    isSupplier: false,
    permissions: { assets: ["view", "edit"], readings: ["view", "create"], documents: CRUD, transfers: VIEW, maintenance: ["view", "create", "edit", "approve"], downtime: ["view", "create", "edit"], quality: ALL, inventory: VIEW, reports: VIEW, sites: VIEW, partners: VIEW },
  },
  {
    key: "technician",
    name: "Technician",
    description: "Records shot readings and uploads photos and documents.",
    isSupplier: false,
    permissions: { assets: VIEW, readings: ["view", "create"], documents: ["view", "create"], transfers: ["view", "edit"], maintenance: ["view", "edit"], downtime: ["view", "create", "edit"], quality: ["view", "create"], inventory: ["view", "edit"], sites: VIEW },
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to the fleet.",
    isSupplier: false,
    permissions: { assets: VIEW, readings: VIEW, documents: VIEW, transfers: VIEW, maintenance: VIEW, downtime: VIEW, quality: VIEW, inventory: VIEW, planning: VIEW, reports: VIEW, sites: VIEW, partners: VIEW },
  },
  {
    key: "supplier_admin",
    name: "Supplier Admin",
    description: "Partner company lead: sees molds in the partner's custody, records readings and documents.",
    isSupplier: true,
    permissions: { assets: VIEW, readings: ["view", "create"], documents: ["view", "create"], transfers: ["view", "create", "edit"], maintenance: ["view", "edit"], downtime: ["view", "create", "edit"], quality: ["view", "create"] },
  },
  {
    key: "supplier_user",
    name: "Supplier User",
    description: "Partner staff: records shot readings on molds in the partner's custody.",
    isSupplier: true,
    permissions: { assets: VIEW, readings: ["view", "create"], documents: VIEW, transfers: ["view", "edit"], maintenance: ["view", "edit"], downtime: ["view", "create", "edit"], quality: ["view", "create"] },
  },
];

/** Built-in roles are immutable, so their permissions always come from code (new modules apply to existing orgs). */
export function rolePermissions(role: { key: string | null; permissions: unknown }): Permissions {
  const builtin = role.key ? BUILTIN_ROLES.find((r) => r.key === role.key) : undefined;
  return builtin ? builtin.permissions : normalizePermissions(role.permissions);
}

export function normalizePermissions(raw: unknown): Permissions {
  const out: Permissions = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [m, acts] of Object.entries(raw as Record<string, unknown>)) {
    if (!(m in MODULES) || !Array.isArray(acts)) continue;
    const valid = acts.filter((a): a is Action => (ACTIONS as readonly string[]).includes(a as string));
    if (valid.length) out[m as Module] = [...new Set(valid)];
  }
  return out;
}

export function can(perms: Permissions, module: Module, action: Action = "view") {
  return !!perms[module]?.includes(action);
}
