"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify, recipientsFor } from "@/lib/notify";
import { AttachmentError, saveAttachments, storeUploads } from "@/lib/attachments";
import { parseDate } from "@/lib/asset-values";
import { str } from "@/lib/forms";
import {
  checklistFromTemplate,
  checklistSummary,
  evaluatePlans,
  nextWorkOrderNumber,
  OPEN_WO,
  parseTaskLines,
  TEMPLATE_KINDS,
  WO_PRIORITY,
  WO_TYPES,
  workOrderScope,
  type TaskResult,
} from "@/lib/maintenance";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

function num(fd: FormData, key: string) {
  const raw = str(fd, key).replace(/,/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function internalOnly(ctx: Ctx, path: string) {
  if (ctx.isSupplier) back(path, "Maintenance plans and templates are managed by the organisation.");
}

// ─── Templates ──────────────────────────────────────────────────────────────

export async function saveTemplateAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "maintenance", id ? "edit" : "create");
  const ret = id ? `/maintenance/templates?edit=${id}` : "/maintenance/templates";
  internalOnly(ctx, ret);
  const name = str(fd, "name");
  if (name.length < 2) back(ret, "Give the template a name.");
  const kind = str(fd, "kind") in TEMPLATE_KINDS ? str(fd, "kind") : "preventive";
  const tasks = parseTaskLines(str(fd, "tasks"));
  if (!tasks.length) back(ret, "Add at least one checklist task (one per line).");
  const hours = num(fd, "estimatedHours");
  if (hours != null && (Number.isNaN(hours) || hours < 0 || hours > 1000)) back(ret, "Estimated hours must be a number between 0 and 1000.");
  const dup = await db.maintenanceTemplate.findFirst({ where: { orgId: ctx.org.id, name: { equals: name, mode: "insensitive" }, NOT: id ? { id } : undefined } });
  if (dup) back(ret, `A template called “${dup.name}” already exists.`);
  const data = { name, kind, description: str(fd, "description"), estimatedHours: hours, tasks: tasks as unknown as Prisma.InputJsonValue };
  if (id) {
    const before = await db.maintenanceTemplate.findFirst({ where: { id, orgId: ctx.org.id } });
    if (!before) back("/maintenance/templates", "Template not found.");
    await db.$transaction(async (tx) => {
      await tx.maintenanceTemplate.update({ where: { id }, data });
      await audit(ctx, { action: "updated", entityType: "maintenance_template", entityId: id, entityLabel: name, before: { name: before.name, kind: before.kind, tasks: before.tasks }, after: data }, tx);
    });
  } else {
    await db.$transaction(async (tx) => {
      const t = await tx.maintenanceTemplate.create({ data: { ...data, orgId: ctx.org.id } });
      await audit(ctx, { action: "created", entityType: "maintenance_template", entityId: t.id, entityLabel: name, after: data }, tx);
    });
  }
  back("/maintenance/templates", `Template “${name}” saved.`, "ok");
}

export async function toggleTemplateAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  internalOnly(ctx, "/maintenance/templates");
  const t = await db.maintenanceTemplate.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!t) back("/maintenance/templates", "Template not found.");
  await db.$transaction(async (tx) => {
    await tx.maintenanceTemplate.update({ where: { id: t.id }, data: { active: !t.active } });
    if (t.active) await tx.maintenancePlan.updateMany({ where: { templateId: t.id }, data: { active: false } });
    await audit(ctx, { action: t.active ? "deactivated" : "activated", entityType: "maintenance_template", entityId: t.id, entityLabel: t.name }, tx);
  });
  back("/maintenance/templates", t.active ? `“${t.name}” deactivated, with its plans.` : `“${t.name}” activated. Re-enable plans where needed.`, "ok");
}

// ─── Plans ──────────────────────────────────────────────────────────────────

/** Add a trigger to one asset, or to every asset of a type in scope. */
export async function addPlanAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "create");
  const ret = str(fd, "return") || "/maintenance/plans";
  internalOnly(ctx, ret);
  const template = await db.maintenanceTemplate.findFirst({ where: { id: str(fd, "templateId"), orgId: ctx.org.id, active: true } });
  if (!template) back(ret, "Choose an active template.");
  const triggerType = str(fd, "triggerType") === "days" ? "days" : "shots";
  const interval = num(fd, "interval");
  if (interval == null || !Number.isInteger(interval) || interval < 1 || interval > 100_000_000) back(ret, `Interval must be a whole number of ${triggerType}.`);
  if (triggerType === "days" && interval > 3650) back(ret, "A calendar interval can be at most 3,650 days.");
  const leadPct = num(fd, "leadPct") ?? 90;
  if (!Number.isInteger(leadPct) || leadPct < 50 || leadPct > 99) back(ret, "Warn-at percentage must be between 50 and 99.");
  const lastDone = str(fd, "lastDone") ? parseDate(str(fd, "lastDone"), "Last done") : ({ ok: true, value: null } as const);
  if (!lastDone.ok) back(ret, lastDone.error);
  const lastShots = num(fd, "lastShots");
  if (lastShots != null && (!Number.isInteger(lastShots) || lastShots < 0)) back(ret, "“Last done at shots” must be a whole number.");

  const where: Prisma.AssetWhereInput = str(fd, "assetTypeId")
    ? { assetTypeId: str(fd, "assetTypeId"), status: { notIn: ["retired", "scrapped"] } }
    : { number: { equals: str(fd, "asset"), mode: "insensitive" } };
  const assets = await db.asset.findMany({ where: { AND: [assetScope(ctx), where] }, include: { meters: true } });
  if (!assets.length) back(ret, str(fd, "assetTypeId") ? "No assets of that type in your scope." : "Asset not found or not in your scope.");
  if (triggerType === "shots" && assets.every((a) => !a.meters.some((m) => m.kind === "shots"))) back(ret, "Shot-based plans need assets with a shot counter. Use a calendar plan instead.");

  let added = 0;
  let skipped = 0;
  await db.$transaction(async (tx) => {
    for (const a of assets) {
      const lifetime = a.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null;
      if (triggerType === "shots" && lifetime == null) { skipped++; continue; }
      const data = {
        triggerType, interval, leadPct, active: true, warnedAt: null,
        baselineShots: lastShots ?? lifetime ?? 0,
        baselineDate: lastDone.value ?? new Date(),
      };
      const p = await tx.maintenancePlan.upsert({ where: { assetId_templateId: { assetId: a.id, templateId: template.id } }, create: { ...data, orgId: ctx.org.id, assetId: a.id, templateId: template.id }, update: data });
      await audit(ctx, { action: "plan_set", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { plan: p.id, template: template.name, every: `${interval} ${triggerType}`, baselineShots: data.baselineShots, baselineDate: data.baselineDate } }, tx);
      added++;
    }
  }, { timeout: 120_000 });
  await evaluatePlans(ctx.org.id, assets.map((a) => a.id));
  back(ret, `Plan set on ${added} asset(s)${skipped ? `; ${skipped} skipped (no shot counter)` : ""}.`, "ok");
}

export async function togglePlanAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const ret = str(fd, "return") || "/maintenance/plans";
  internalOnly(ctx, ret);
  const p = await db.maintenancePlan.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: true, template: true } });
  if (!p) back(ret, "Plan not found.");
  await db.$transaction(async (tx) => {
    await tx.maintenancePlan.update({ where: { id: p.id }, data: { active: !p.active } });
    await audit(ctx, { action: p.active ? "plan_paused" : "plan_resumed", entityType: "asset", entityId: p.assetId, entityLabel: `${p.asset.number} ${p.asset.name}`, after: { template: p.template.name } }, tx);
  });
  back(ret, p.active ? "Plan paused." : "Plan resumed.", "ok");
}

export async function runTriggersAction() {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "create");
  internalOnly(ctx, "/maintenance/plans");
  const r = await evaluatePlans(ctx.org.id);
  back("/maintenance/plans", `Checked ${r.plans} plan(s): ${r.raised} work order(s) raised, ${r.warned} early warning(s).`, "ok");
}

// ─── Work orders ────────────────────────────────────────────────────────────

async function loadWo(ctx: Ctx, id: string) {
  const wo = await db.workOrder.findFirst({ where: { AND: [workOrderScope(ctx), { id }] }, include: { asset: { include: { meters: true } }, plan: true, labor: true, parts: true } });
  if (!wo) back("/maintenance", "Work order not found or not in your scope.");
  return wo;
}

/** Suppliers work on orders for molds they hold or that are assigned to their company. */
function canWork(ctx: Ctx, wo: { assignedPartnerId: string | null; asset: { custodianPartnerId: string | null } }) {
  if (!ctx.isSupplier) return true;
  return !!ctx.scope.partnerId && (wo.assignedPartnerId === ctx.scope.partnerId || wo.asset.custodianPartnerId === ctx.scope.partnerId);
}

function readAssignee(fd: FormData) {
  const v = str(fd, "assignee");
  if (v.startsWith("u:")) return { assignedUserId: v.slice(2), assignedPartnerId: null };
  if (v.startsWith("p:")) return { assignedUserId: null, assignedPartnerId: v.slice(2) };
  return { assignedUserId: null, assignedPartnerId: null };
}

async function validAssignee(ctx: Ctx, a: { assignedUserId: string | null; assignedPartnerId: string | null }) {
  if (a.assignedUserId && !(await db.membership.findFirst({ where: { orgId: ctx.org.id, userId: a.assignedUserId, status: "active" } }))) return false;
  if (a.assignedPartnerId && !(await db.partner.findFirst({ where: { orgId: ctx.org.id, id: a.assignedPartnerId } }))) return false;
  return true;
}

async function notifyAssignee(ctx: Ctx, wo: { id: string; number: string; title: string; assetId: string }, a: { assignedUserId: string | null; assignedPartnerId: string | null }, siteId: string) {
  const link = `/maintenance/work-orders/${wo.id}`;
  const users = a.assignedUserId ? [a.assignedUserId] : a.assignedPartnerId ? await recipientsFor(ctx.org.id, "maintenance", "edit", { siteId, partnerIds: [a.assignedPartnerId] }) : [];
  await notify(ctx.org.id, users, { kind: "wo_assigned", title: `Work order ${wo.number} assigned`, body: wo.title, link, dedupeKey: `wo-assigned:${wo.id}:${a.assignedUserId ?? a.assignedPartnerId}` }, { exceptUserId: ctx.user.id });
}

export async function createWorkOrderAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "create");
  const ret = `/maintenance/work-orders/new?asset=${encodeURIComponent(str(fd, "asset"))}`;
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: str(fd, "asset"), mode: "insensitive" } }] }, include: { meters: true } });
  if (!a) back(ret, "Asset not found or not in your scope.");
  const type = str(fd, "type") in WO_TYPES ? str(fd, "type") : "corrective";
  const title = str(fd, "title");
  if (title.length < 3) back(ret, "Give the work order a short title.");
  const priority = str(fd, "priority") in WO_PRIORITY ? str(fd, "priority") : "medium";
  const due = str(fd, "dueDate") ? parseDate(str(fd, "dueDate"), "Due date") : ({ ok: true, value: null } as const);
  if (!due.ok) back(ret, due.error);
  const template = str(fd, "templateId") ? await db.maintenanceTemplate.findFirst({ where: { id: str(fd, "templateId"), orgId: ctx.org.id } }) : null;
  const assignee = ctx.isSupplier ? { assignedUserId: null, assignedPartnerId: ctx.scope.partnerId } : readAssignee(fd);
  if (!(await validAssignee(ctx, assignee))) back(ret, "Choose a valid assignee.");
  const wo = await db.$transaction(async (tx) => {
    const number = await nextWorkOrderNumber(tx, ctx.org.id);
    const wo = await tx.workOrder.create({
      data: {
        orgId: ctx.org.id, number, assetId: a.id, type, title, description: str(fd, "description"), priority, dueDate: due.value, source: "manual", createdById: ctx.user.id,
        templateId: template?.id ?? null, checklist: checklistFromTemplate(template?.tasks) as unknown as Prisma.InputJsonValue, ...assignee,
      },
    });
    await audit(ctx, { action: "created", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: a.number, type, title, priority, template: template?.name } }, tx);
    return wo;
  });
  await notifyAssignee(ctx, wo, assignee, a.siteId);
  back(`/maintenance/work-orders/${wo.id}`, `Work order ${wo.number} created.`, "ok");
}

export async function assignWorkOrderAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "create");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (ctx.isSupplier) back(path, "Assignment is made by the organisation.");
  if (!OPEN_WO.includes(wo.status)) back(path, "This work order is closed.");
  const a = readAssignee(fd);
  if (!(await validAssignee(ctx, a))) back(path, "Choose a valid assignee.");
  const priority = str(fd, "priority") in WO_PRIORITY ? str(fd, "priority") : wo.priority;
  const due = str(fd, "dueDate") ? parseDate(str(fd, "dueDate"), "Due date") : ({ ok: true, value: null } as const);
  if (!due.ok) back(path, due.error);
  await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: wo.id }, data: { ...a, priority, dueDate: due.value ?? wo.dueDate } });
    await audit(ctx, { action: "assigned", entityType: "work_order", entityId: wo.id, entityLabel: wo.number, before: { assignedUserId: wo.assignedUserId, assignedPartnerId: wo.assignedPartnerId, priority: wo.priority, dueDate: wo.dueDate }, after: { ...a, priority, dueDate: due.value ?? wo.dueDate } }, tx);
  });
  if (a.assignedUserId !== wo.assignedUserId || a.assignedPartnerId !== wo.assignedPartnerId) await notifyAssignee(ctx, wo, a, wo.asset.siteId);
  back(path, "Assignment updated.", "ok");
}

/** start | hold | resume */
export async function workOrderStatusAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (!canWork(ctx, wo)) back(path, "Only the assigned company can work on this order.");
  const event = str(fd, "step");
  const next = event === "start" && wo.status === "open" ? "in_progress" : event === "hold" && wo.status === "in_progress" ? "on_hold" : event === "resume" && wo.status === "on_hold" ? "in_progress" : null;
  if (!next) back(path, `This work order is ${wo.status.replace("_", " ")}; that step is not available.`);
  const reason = str(fd, "reason");
  if (event === "hold" && !reason) back(path, "Say why the work is on hold (e.g. waiting for parts).");
  await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: wo.id }, data: { status: next, ...(event === "start" ? { startedAt: new Date() } : {}) } });
    await audit(ctx, { action: event === "start" ? "started" : event === "hold" ? "put_on_hold" : "resumed", entityType: "work_order", entityId: wo.id, entityLabel: wo.number, reason }, tx);
    if (event === "start" && wo.type === "refurbishment" && wo.asset.status === "active") {
      await tx.asset.update({ where: { id: wo.assetId }, data: { status: "refurbishing" } });
      await audit(ctx, { action: "status_changed", entityType: "asset", entityId: wo.assetId, entityLabel: `${wo.asset.number} ${wo.asset.name}`, before: { status: wo.asset.status }, after: { status: "refurbishing" }, reason: `Work order ${wo.number} started` }, tx);
    }
  });
  back(path, event === "start" ? "Work started." : event === "hold" ? "On hold." : "Resumed.", "ok");
}

function readChecklist(fd: FormData, current: TaskResult[]): TaskResult[] {
  return current.map((t) => {
    const r = str(fd, `${t.id}.result`);
    const v = str(fd, `${t.id}.value`).replace(/,/g, "");
    return {
      ...t,
      result: r === "pass" || r === "fail" || r === "na" ? r : t.type === "measure" && v !== "" ? "pass" : null,
      value: v === "" ? null : Number(v),
      note: str(fd, `${t.id}.note`).slice(0, 500),
    };
  });
}

/** Save progress — checklist, findings and photos. The same form's second button completes (below). */
export async function saveWorkOrderAction(fd: FormData) {
  await saveOrComplete(fd, false);
}

export async function completeWorkOrderAction(fd: FormData) {
  await saveOrComplete(fd, true);
}

async function saveOrComplete(fd: FormData, complete: boolean) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (!canWork(ctx, wo)) back(path, "Only the assigned company can work on this order.");
  if (!OPEN_WO.includes(wo.status)) back(path, "This work order is closed.");
  const raw = readChecklist(fd, (wo.checklist ?? []) as unknown as TaskResult[]);
  if (raw.some((t) => t.value != null && !Number.isFinite(t.value))) back(path, "Measurements must be numbers.");
  const summary = checklistSummary(raw);
  const external = num(fd, "externalCost");
  if (external != null && (Number.isNaN(external) || external < 0)) back(path, "External cost must be a positive amount.");

  let files: Awaited<ReturnType<typeof storeUploads>> = [];
  let error = "";
  try {
    files = await storeUploads(ctx.org.id, fd.getAll("photos"));
  } catch (e) {
    if (!(e instanceof AttachmentError)) throw e;
    error = e.message;
  }
  if (error) back(path, error);

  const lifetime = wo.asset.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null;
  const fields = { checklist: summary.tasks as unknown as Prisma.InputJsonValue, passPct: summary.passPct, rootCause: str(fd, "rootCause"), resolution: str(fd, "resolution"), ...(external != null ? { externalCost: external } : {}) };

  if (!complete) {
    await db.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id: wo.id }, data: { ...fields, ...(wo.status === "open" ? { status: "in_progress", startedAt: new Date() } : {}) } });
      await saveAttachments(tx, ctx.org.id, "work_order", wo.id, files, ctx.user.id);
    });
    back(path, "Progress saved.", "ok");
  }

  // ── Completion rules
  if (summary.missing.length) back(path, `Complete the required items first: ${summary.missing.slice(0, 5).map((t) => t.text).join("; ")}${summary.missing.length > 5 ? "…" : ""}`);
  const signedByName = str(fd, "signedByName");
  if (signedByName.length < 3) back(path, "Type your full name to sign off the work.");
  if (wo.type === "corrective" && !fields.resolution) back(path, "Describe the fix in “Resolution” before closing a corrective work order.");
  if (wo.clearsQuarantine && summary.failed.length) back(path, "A quarantine cannot be released with failed items. Fix them, or scrap the mold from its passport.");
  const shotsAt = num(fd, "shotsAtCompletion");
  if (shotsAt != null && (Number.isNaN(shotsAt) || !Number.isInteger(shotsAt) || shotsAt < 0)) back(path, "Shots at completion must be a whole number.");
  if (shotsAt != null && lifetime != null && shotsAt > lifetime) back(path, `Shots at completion can't be above the current lifetime count (${lifetime.toLocaleString("en-IN")}). Record a reading first.`);
  const followUp = summary.failed.length > 0 && str(fd, "followUp") === "on";
  const now = new Date();
  const doneShots = shotsAt ?? lifetime;

  const follow = await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: wo.id }, data: { ...fields, status: "completed", completedAt: now, completedById: ctx.user.id, signedByName, signedAt: now, shotsAtCompletion: doneShots, startedAt: wo.startedAt ?? now } });
    await saveAttachments(tx, ctx.org.id, "work_order", wo.id, files, ctx.user.id);
    await audit(ctx, { action: "completed", entityType: "work_order", entityId: wo.id, entityLabel: wo.number, after: { asset: wo.asset.number, passPct: summary.passPct, failed: summary.failed.map((t) => t.text), shots: doneShots, signedBy: signedByName } }, tx);
    // The plan's interval restarts from this service.
    if (wo.planId) await tx.maintenancePlan.update({ where: { id: wo.planId }, data: { baselineShots: doneShots ?? wo.plan?.baselineShots ?? 0, baselineDate: now, warnedAt: null } });
    const assetData: Prisma.AssetUpdateInput = {};
    if (wo.type === "refurbishment") Object.assign(assetData, { lastRefurbShots: doneShots, lastRefurbDate: now, refurbsDone: { increment: 1 } });
    const otherOpen = await tx.workOrder.count({ where: { assetId: wo.assetId, id: { not: wo.id }, status: { in: OPEN_WO }, OR: [{ type: "refurbishment" }, { clearsQuarantine: true }] } });
    let newStatus: string | null = null;
    if (wo.clearsQuarantine && wo.asset.status === "quarantined" && !otherOpen) newStatus = "active";
    if (wo.type === "refurbishment" && wo.asset.status === "refurbishing" && !otherOpen) newStatus = "active";
    if (newStatus) assetData.status = newStatus;
    if (Object.keys(assetData).length) {
      await tx.asset.update({ where: { id: wo.assetId }, data: assetData });
      if (newStatus) await audit(ctx, { action: "status_changed", entityType: "asset", entityId: wo.assetId, entityLabel: `${wo.asset.number} ${wo.asset.name}`, before: { status: wo.asset.status }, after: { status: newStatus }, reason: `Work order ${wo.number} completed` }, tx);
    }
    if (!followUp) return null;
    const number = await nextWorkOrderNumber(tx, ctx.org.id);
    const f = await tx.workOrder.create({
      data: {
        orgId: ctx.org.id, number, assetId: wo.assetId, type: "corrective", title: `Fix failed checks from ${wo.number}`, description: summary.failed.map((t) => `• ${t.text}${t.value != null ? ` (${t.value}${t.unit ? ` ${t.unit}` : ""})` : ""}${t.note ? ` — ${t.note}` : ""}`).join("\n"),
        priority: "high", source: "checklist_failure", sourceId: wo.id, createdById: ctx.user.id, dueDate: new Date(now.getTime() + 7 * 86_400_000), ...(wo.assignedUserId || wo.assignedPartnerId
          ? { assignedUserId: wo.assignedUserId, assignedPartnerId: wo.assignedPartnerId }
          : ctx.isSupplier ? { assignedPartnerId: ctx.scope.partnerId } : { assignedUserId: ctx.user.id }),
      },
    });
    await audit(ctx, { action: "created", entityType: "work_order", entityId: f.id, entityLabel: number, after: { asset: wo.asset.number, from: `failed checks on ${wo.number}` } }, tx);
    return f;
  });
  if (follow) await notifyAssignee(ctx, follow, follow, wo.asset.siteId);
  if (wo.createdById && wo.createdById !== ctx.user.id) await notify(ctx.org.id, [wo.createdById], { kind: "wo_completed", title: `${wo.number} completed`, body: `${wo.title} on ${wo.asset.number}${summary.failed.length ? ` — ${summary.failed.length} failed check(s)` : ""}.`, link: path });
  back(follow ? `/maintenance/work-orders/${follow.id}` : path, follow ? `${wo.number} completed. Follow-up ${follow.number} raised for the failed checks.` : `${wo.number} completed and signed off.`, "ok");
}

export async function addLaborAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (!canWork(ctx, wo) || !OPEN_WO.includes(wo.status)) back(path, "Labour can only be added to open work you are working on.");
  const hours = num(fd, "hours");
  if (hours == null || Number.isNaN(hours) || hours <= 0 || hours > 200) back(path, "Hours must be between 0 and 200.");
  const rate = num(fd, "rate") ?? 0;
  if (Number.isNaN(rate) || rate < 0) back(path, "Rate must be a positive amount.");
  const workerName = str(fd, "workerName") || `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
  await db.workOrderLabor.create({ data: { workOrderId: wo.id, userId: str(fd, "workerName") ? null : ctx.user.id, workerName, hours, rate, note: str(fd, "note") } });
  back(path, "Labour added.", "ok");
}

export async function addPartAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (!canWork(ctx, wo) || !OPEN_WO.includes(wo.status)) back(path, "Parts can only be added to open work you are working on.");
  const description = str(fd, "description");
  if (!description) back(path, "Describe the part.");
  const quantity = num(fd, "quantity");
  if (quantity == null || Number.isNaN(quantity) || quantity <= 0) back(path, "Quantity must be above zero.");
  const unitCost = num(fd, "unitCost") ?? 0;
  if (Number.isNaN(unitCost) || unitCost < 0) back(path, "Unit cost must be a positive amount.");
  await db.workOrderPart.create({ data: { workOrderId: wo.id, partNumber: str(fd, "partNumber"), description, quantity, unitCost } });
  back(path, "Part added.", "ok");
}

export async function removeCostLineAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "edit");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (!canWork(ctx, wo) || !OPEN_WO.includes(wo.status)) back(path, "This work order is closed.");
  if (str(fd, "kind") === "labor") await db.workOrderLabor.deleteMany({ where: { id: str(fd, "lineId"), workOrderId: wo.id } });
  else await db.workOrderPart.deleteMany({ where: { id: str(fd, "lineId"), workOrderId: wo.id } });
  back(path, "Removed.", "ok");
}

export async function cancelWorkOrderAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance", "create");
  const wo = await loadWo(ctx, str(fd, "id"));
  const path = `/maintenance/work-orders/${wo.id}`;
  if (ctx.isSupplier) back(path, "Work orders are cancelled by the organisation.");
  if (!OPEN_WO.includes(wo.status)) back(path, "This work order is already closed.");
  if (wo.clearsQuarantine && wo.asset.status === "quarantined") back(path, "This order releases a quarantine. Complete it, or scrap the mold from its passport.");
  const reason = str(fd, "reason");
  if (!reason) back(path, "Give a reason for cancelling.");
  await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id: wo.id }, data: { status: "cancelled", cancelReason: reason } });
    await audit(ctx, { action: "cancelled", entityType: "work_order", entityId: wo.id, entityLabel: wo.number, reason }, tx);
    if (wo.type === "refurbishment" && wo.asset.status === "refurbishing") {
      await tx.asset.update({ where: { id: wo.assetId }, data: { status: "active" } });
      await audit(ctx, { action: "status_changed", entityType: "asset", entityId: wo.assetId, entityLabel: `${wo.asset.number} ${wo.asset.name}`, before: { status: "refurbishing" }, after: { status: "active" }, reason: `Work order ${wo.number} cancelled` }, tx);
    }
    // A cancelled planned order restarts the interval so the trigger doesn't immediately fire again.
    if (wo.planId) {
      const lifetime = wo.asset.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null;
      await tx.maintenancePlan.update({ where: { id: wo.planId }, data: { baselineShots: lifetime ?? wo.plan?.baselineShots ?? 0, baselineDate: new Date(), warnedAt: null } });
    }
  });
  back(path, "Work order cancelled.", "ok");
}
