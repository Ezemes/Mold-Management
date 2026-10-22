import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { rolePermissions, can, type Action, type Module } from "./permissions";
import { appUrl, sendMail } from "./mail";

type Msg = { kind: string; title: string; body?: string; link?: string; dedupeKey?: string };

/**
 * Users who may act on something at a site: internal users with the permission whose scope covers the site,
 * plus users of the partner that owns the site (when `includePartner`).
 */
export async function recipientsFor(orgId: string, module: Module, action: Action, where: { siteId?: string; partnerIds?: (string | null)[] }) {
  const site = where.siteId ? await db.site.findUnique({ where: { id: where.siteId } }) : null;
  const ms = await db.membership.findMany({ where: { orgId, status: "active", user: { status: "active" } }, include: { role: true } });
  return ms
    .filter((m) => can(rolePermissions(m.role), module, action))
    .filter((m) => {
      if (m.role.isSupplier || m.scopeType === "partner") return !!m.partnerId && (where.partnerIds ?? []).includes(m.partnerId);
      if (m.scopeType === "all" || !site) return true;
      if (m.scopeType === "sites") return m.scopeIds.includes(site.id);
      if (m.scopeType === "divisions") return !!site.divisionId && m.scopeIds.includes(site.divisionId);
      return false;
    })
    .map((m) => m.userId);
}

/** In-app notification plus email. Duplicate dedupe keys per user are ignored. */
export async function notify(orgId: string, userIds: string[], msg: Msg, opts: { exceptUserId?: string; tx?: Prisma.TransactionClient } = {}) {
  const ids = [...new Set(userIds)].filter((u) => u !== opts.exceptUserId);
  if (!ids.length) return 0;
  const client = opts.tx ?? db;
  const res = await client.notification.createMany({
    data: ids.map((userId) => ({ orgId, userId, kind: msg.kind, title: msg.title, body: msg.body ?? "", link: msg.link ?? "", dedupeKey: msg.dedupeKey ?? null })),
    skipDuplicates: true,
  });
  if (res.count && !opts.tx) await emailPending(ids);
  return res.count;
}

/** Send emails for notifications not yet emailed (called after commit). */
export async function emailPending(userIds?: string[]) {
  const rows = await db.notification.findMany({ where: { emailedAt: null, ...(userIds ? { userId: { in: userIds } } : {}) }, include: { user: true }, take: 500 });
  for (const n of rows) await sendMail(n.user.email, n.title, `${n.body}\n\n${n.link ? appUrl(n.link) : ""}`.trim());
  if (rows.length) await db.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { emailedAt: new Date() } });
}
