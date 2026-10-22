"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { appUrl, sendMail } from "@/lib/mail";
import { MODULES, ACTIONS, normalizePermissions, type Module } from "@/lib/permissions";
import { PARTNER_KINDS, SITE_KINDS } from "@/lib/assets";
import { normalizeRules, RULES } from "@/lib/compat.pure";
import { TIMEZONES } from "@/lib/india";
import { int, str, token } from "@/lib/forms";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Divisions & sites ──────────────────────────────────────────────────────

export async function saveDivisionAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "sites", id ? "edit" : "create");
  const name = str(fd, "name");
  if (!name) back("/admin/sites", "Division name is required.");
  const data = { name, code: str(fd, "code") };
  if (id) {
    const before = await db.division.findFirstOrThrow({ where: { id, orgId: ctx.org.id } });
    const after = await db.division.update({ where: { id }, data });
    await audit(ctx, { action: "updated", entityType: "division", entityId: id, entityLabel: name, before, after });
  } else {
    if (await db.division.findFirst({ where: { orgId: ctx.org.id, name } })) back("/admin/sites", "A division with that name exists.");
    const d = await db.division.create({ data: { ...data, orgId: ctx.org.id } });
    await audit(ctx, { action: "created", entityType: "division", entityId: d.id, entityLabel: name, after: d });
  }
  back("/admin/sites", "Division saved.", "ok");
}

function siteData(fd: FormData) {
  const kind = str(fd, "kind");
  const tz = str(fd, "timezone");
  return {
    name: str(fd, "name"),
    code: str(fd, "code"),
    kind: kind in SITE_KINDS ? kind : "plant",
    divisionId: str(fd, "divisionId") || null,
    partnerId: str(fd, "partnerId") || null,
    address: str(fd, "address"),
    city: str(fd, "city"),
    state: str(fd, "state"),
    country: (str(fd, "country") || "IN").toUpperCase().slice(0, 2),
    postalCode: str(fd, "postalCode"),
    timezone: (TIMEZONES as readonly string[]).includes(tz) ? tz : "Asia/Kolkata",
    latitude: num(fd, "latitude"),
    longitude: num(fd, "longitude"),
    active: str(fd, "active") !== "0",
  };
}

export async function saveSiteAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "sites", id ? "edit" : "create");
  const data = siteData(fd);
  const ret = id ? `/admin/sites/${id}` : "/admin/sites";
  if (!data.name) back(ret, "Site name is required.");
  if (data.latitude != null && (data.latitude < -90 || data.latitude > 90)) back(ret, "Latitude must be between -90 and 90.");
  if (data.longitude != null && (data.longitude < -180 || data.longitude > 180)) back(ret, "Longitude must be between -180 and 180.");
  if (data.divisionId && !(await db.division.findFirst({ where: { id: data.divisionId, orgId: ctx.org.id } }))) back(ret, "Unknown division.");
  if (data.partnerId && !(await db.partner.findFirst({ where: { id: data.partnerId, orgId: ctx.org.id } }))) back(ret, "Unknown partner.");
  const dup = await db.site.findFirst({ where: { orgId: ctx.org.id, name: data.name, NOT: id ? { id } : undefined } });
  if (dup) back(ret, "A site with that name exists.");
  if (id) {
    const before = await db.site.findFirstOrThrow({ where: { id, orgId: ctx.org.id } });
    if (before.partnerId !== data.partnerId && (await db.asset.count({ where: { siteId: id, deletedAt: null } }))) {
      back(ret, "This site holds assets, so its owner (own site vs partner) cannot change. Move the assets first.");
    }
    const after = await db.site.update({ where: { id }, data });
    await audit(ctx, { action: "updated", entityType: "site", entityId: id, entityLabel: after.name, before, after });
    back(ret, "Site saved.", "ok");
  }
  const s = await db.site.create({ data: { ...data, orgId: ctx.org.id } });
  await audit(ctx, { action: "created", entityType: "site", entityId: s.id, entityLabel: s.name, after: s });
  back(`/admin/sites/${s.id}`, "Site created.", "ok");
}

// ─── Partners ───────────────────────────────────────────────────────────────

export async function savePartnerAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "partners", id ? "edit" : "create");
  const kind = str(fd, "kind");
  const gstin = str(fd, "gstin").toUpperCase();
  const data = {
    name: str(fd, "name"),
    kind: kind in PARTNER_KINDS ? kind : "molder",
    code: str(fd, "code"),
    gstin,
    contactName: str(fd, "contactName"),
    contactEmail: str(fd, "contactEmail").toLowerCase(),
    contactPhone: str(fd, "contactPhone"),
    country: (str(fd, "country") || "IN").toUpperCase().slice(0, 2),
    status: str(fd, "status") === "inactive" ? "inactive" : "active",
  };
  const ret = id ? `/admin/partners/${id}` : "/admin/partners";
  if (!data.name) back(ret, "Partner name is required.");
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) back(ret, "GSTIN should be 15 characters, e.g. 27AAPFU0939F1ZV.");
  const dup = await db.partner.findFirst({ where: { orgId: ctx.org.id, name: data.name, NOT: id ? { id } : undefined } });
  if (dup) back(ret, "A partner with that name exists.");
  if (id) {
    const before = await db.partner.findFirstOrThrow({ where: { id, orgId: ctx.org.id } });
    const after = await db.partner.update({ where: { id }, data });
    await audit(ctx, { action: "updated", entityType: "partner", entityId: id, entityLabel: after.name, before, after });
    back(ret, "Partner saved.", "ok");
  }
  const p = await db.partner.create({ data: { ...data, orgId: ctx.org.id } });
  await audit(ctx, { action: "created", entityType: "partner", entityId: p.id, entityLabel: p.name, after: p });
  back(`/admin/partners/${p.id}`, "Partner created. Add its sites and invite its users.", "ok");
}

// ─── Users & invitations ────────────────────────────────────────────────────

async function scopeFrom(ctx: Awaited<ReturnType<typeof requireOrg>>, fd: FormData, roleIsSupplier: boolean, path: string) {
  if (roleIsSupplier) {
    const partnerId = str(fd, "partnerId");
    if (!partnerId || !(await db.partner.findFirst({ where: { id: partnerId, orgId: ctx.org.id } }))) back(path, "Supplier roles need a partner organisation.");
    return { scopeType: "partner", scopeIds: [] as string[], partnerId };
  }
  const scopeType = ["all", "sites", "divisions"].includes(str(fd, "scopeType")) ? str(fd, "scopeType") : "all";
  const ids = fd.getAll("scopeIds").map(String).filter(Boolean);
  if (scopeType === "sites") {
    const ok = await db.site.count({ where: { orgId: ctx.org.id, id: { in: ids } } });
    if (!ids.length || ok !== ids.length) back(path, "Choose at least one site for a site-scoped user.");
  }
  if (scopeType === "divisions") {
    const ok = await db.division.count({ where: { orgId: ctx.org.id, id: { in: ids } } });
    if (!ids.length || ok !== ids.length) back(path, "Choose at least one division for a division-scoped user.");
  }
  return { scopeType, scopeIds: scopeType === "all" ? [] : ids, partnerId: null as string | null };
}

export async function inviteUserAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "users", "create");
  const path = str(fd, "return") || "/admin/users";
  const email = str(fd, "email").toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) back(path, "Enter a valid email address.");
  const role = await db.role.findFirst({ where: { id: str(fd, "roleId"), orgId: ctx.org.id } });
  if (!role) back(path, "Choose a role.");
  if (role.key === "org_admin" && ctx.role.key !== "org_admin") back(path, "Only an Org Admin can invite another Org Admin.");
  const scope = await scopeFrom(ctx, fd, role.isSupplier, path);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && (await db.membership.findUnique({ where: { userId_orgId: { userId: existing.id, orgId: ctx.org.id } } }))) back(path, "That person already has access.");
  await db.invite.updateMany({ where: { orgId: ctx.org.id, email, status: "pending" }, data: { status: "revoked" } });
  const t = token();
  await db.invite.create({ data: { orgId: ctx.org.id, email, roleId: role.id, ...scope, token: t, invitedById: ctx.user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  await sendMail(email, `You're invited to ${ctx.org.name} on Plant Metrics`, `${ctx.user.firstName || ctx.user.email} invited you as ${role.name}. Accept: ${appUrl(`/accept-invite?token=${t}`)}`);
  await audit(ctx, { action: "invited", entityType: "user", entityLabel: email, after: { email, role: role.name, ...scope } });
  back(path, `Invitation sent to ${email}.`, "ok");
}

export async function revokeInviteAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "users", "delete");
  const inv = await db.invite.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id, status: "pending" } });
  if (!inv) back("/admin/users", "Invitation not found.");
  await db.invite.update({ where: { id: inv.id }, data: { status: "revoked" } });
  await audit(ctx, { action: "revoked_invite", entityType: "user", entityLabel: inv.email });
  back("/admin/users", "Invitation revoked.", "ok");
}

async function adminCount(orgId: string) {
  return db.membership.count({ where: { orgId, status: "active", role: { key: "org_admin" } } });
}

export async function updateMemberAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "users", "edit");
  const m = await db.membership.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id }, include: { role: true, user: true } });
  const path = `/admin/users/${str(fd, "id")}`;
  if (!m) back("/admin/users", "Member not found.");
  const role = await db.role.findFirst({ where: { id: str(fd, "roleId"), orgId: ctx.org.id } });
  if (!role) back(path, "Choose a role.");
  if ((role.key === "org_admin") !== (m.role.key === "org_admin") && ctx.role.key !== "org_admin") back(path, "Only an Org Admin can grant or remove Org Admin.");
  if (m.role.key === "org_admin" && role.key !== "org_admin" && (await adminCount(ctx.org.id)) <= 1) back(path, "The organisation needs at least one Org Admin.");
  const scope = await scopeFrom(ctx, fd, role.isSupplier, path);
  const status = str(fd, "status") === "suspended" ? "suspended" : "active";
  if (m.userId === ctx.user.id && status === "suspended") back(path, "You cannot suspend yourself.");
  if (m.role.key === "org_admin" && status === "suspended" && (await adminCount(ctx.org.id)) <= 1) back(path, "The organisation needs at least one active Org Admin.");
  const before = { role: m.role.name, scopeType: m.scopeType, scopeIds: m.scopeIds, partnerId: m.partnerId, status: m.status };
  await db.membership.update({ where: { id: m.id }, data: { roleId: role.id, ...scope, status } });
  await audit(ctx, { action: "updated_access", entityType: "user", entityId: m.userId, entityLabel: m.user.email, before, after: { role: role.name, ...scope, status } });
  back(path, "Access updated.", "ok");
}

export async function removeMemberAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "users", "delete");
  const m = await db.membership.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id }, include: { role: true, user: true } });
  if (!m) back("/admin/users", "Member not found.");
  if (m.userId === ctx.user.id) back(`/admin/users/${m.id}`, "You cannot remove yourself.");
  if (m.role.key === "org_admin" && (await adminCount(ctx.org.id)) <= 1) back(`/admin/users/${m.id}`, "The organisation needs at least one Org Admin.");
  await db.membership.delete({ where: { id: m.id } });
  await audit(ctx, { action: "removed", entityType: "user", entityId: m.userId, entityLabel: m.user.email, before: { role: m.role.name } });
  back("/admin/users", `${m.user.email} removed.`, "ok");
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export async function saveRoleAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "roles", id ? "edit" : "create");
  const name = str(fd, "name");
  const path = id ? `/admin/roles/${id}` : "/admin/roles";
  if (!name) back(path, "Role name is required.");
  const perms: Record<string, string[]> = {};
  for (const m of Object.keys(MODULES) as Module[]) {
    const acts = ACTIONS.filter((a) => fd.get(`perm.${m}.${a}`) === "on");
    if (acts.length && !acts.includes("view")) acts.unshift("view"); // any action implies view
    if (acts.length) perms[m] = acts;
  }
  const isSupplier = str(fd, "isSupplier") === "1";
  if (isSupplier) for (const m of ["users", "roles", "settings", "audit", "asset_types", "sites", "partners", "import_export", "inventory", "planning", "reports", "integrations"]) delete perms[m];
  // Approving transfers or work orders is an internal decision.
  if (isSupplier) for (const m of Object.keys(perms)) perms[m] = perms[m].filter((a) => a !== "approve");
  const permissions = normalizePermissions(perms) as Prisma.InputJsonValue;
  if (id) {
    const before = await db.role.findFirstOrThrow({ where: { id, orgId: ctx.org.id } });
    if (before.key) back(path, "Built-in roles cannot be changed. Duplicate it to make a custom role.");
    const after = await db.role.update({ where: { id }, data: { name, description: str(fd, "description"), permissions, isSupplier } });
    await audit(ctx, { action: "updated", entityType: "role", entityId: id, entityLabel: name, before, after });
    back(path, "Role saved.", "ok");
  }
  if (await db.role.findFirst({ where: { orgId: ctx.org.id, name } })) back(path, "A role with that name exists.");
  const r = await db.role.create({ data: { orgId: ctx.org.id, name, description: str(fd, "description"), permissions, isSupplier } });
  await audit(ctx, { action: "created", entityType: "role", entityId: r.id, entityLabel: name, after: r });
  back(`/admin/roles/${r.id}`, "Role created.", "ok");
}

export async function deleteRoleAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "roles", "delete");
  const r = await db.role.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id }, include: { _count: { select: { memberships: true } } } });
  if (!r) back("/admin/roles", "Role not found.");
  if (r.key) back(`/admin/roles/${r.id}`, "Built-in roles cannot be deleted.");
  if (r._count.memberships) back(`/admin/roles/${r.id}`, `${r._count.memberships} user(s) still have this role. Reassign them first.`);
  await db.role.delete({ where: { id: r.id } });
  await audit(ctx, { action: "deleted", entityType: "role", entityId: r.id, entityLabel: r.name, before: r });
  back("/admin/roles", "Role deleted.", "ok");
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveSettingsAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "settings", "edit");
  const tz = str(fd, "timezone");
  const data = {
    name: str(fd, "name") || ctx.org.name,
    timezone: (TIMEZONES as readonly string[]).includes(tz) ? tz : ctx.org.timezone,
    currency: /^[A-Z]{3}$/.test(str(fd, "currency")) ? str(fd, "currency") : ctx.org.currency,
    numberFormat: str(fd, "numberFormat") === "international" ? "international" : "indian",
    unitSystem: str(fd, "unitSystem") === "imperial" ? "imperial" : "metric",
    readingOverdueDays: Math.min(365, Math.max(1, int(fd, "readingOverdueDays") || 30)),
    transferApproval: ["always", "cross_company", "never"].includes(str(fd, "transferApproval")) ? str(fd, "transferApproval") : ctx.org.transferApproval,
    transferShotTolerance: Math.min(1_000_000, Math.max(0, int(fd, "transferShotTolerance"))),
    requalifyOnTransfer: str(fd, "requalifyOnTransfer") === "on",
    capacityHoursPerMonth: Math.min(744, Math.max(1, int(fd, "capacityHoursPerMonth") || 600)),
    defaultOeePct: Math.min(100, Math.max(1, int(fd, "defaultOeePct") || 75)),
    refurbDowntimeDays: Math.min(365, Math.max(0, int(fd, "refurbDowntimeDays"))),
    reconTolerancePct: Math.min(100, Math.max(0, int(fd, "reconTolerancePct"))),
    reconMinShots: Math.min(1_000_000, Math.max(0, int(fd, "reconMinShots"))),
    reconWindowDays: Math.min(31, Math.max(0, int(fd, "reconWindowDays"))),
    compatRules: normalizeRules({
      enabled: Object.fromEntries(Object.keys(RULES).map((k) => [k, str(fd, `rule.${k}`) === "on"])),
      tonnageMarginPct: Number(str(fd, "tonnageMarginPct")),
      shotMinPct: Number(str(fd, "shotMinPct")),
      shotMaxPct: Number(str(fd, "shotMaxPct")),
      ringTolMm: Number(str(fd, "ringTolMm")),
    }) as unknown as Prisma.InputJsonValue,
  };
  const after = await db.organisation.update({ where: { id: ctx.org.id }, data });
  await audit(ctx, { action: "updated", entityType: "settings", entityId: ctx.org.id, entityLabel: after.name, before: ctx.org, after });
  back("/admin/settings", "Settings saved.", "ok");
}
