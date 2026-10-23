"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify, recipientsFor } from "@/lib/notify";
import { localInputToDate } from "@/lib/format";
import { str } from "@/lib/forms";
import { nextWorkOrderNumber, workOrderScope } from "@/lib/maintenance";
import { pressScope } from "@/lib/compat";
import { createDowntime, DOWNTIME_CATEGORIES, downtimeScope, DowntimeError, emitDowntime, ensureCodes, otherEvents, validateDowntime } from "@/lib/downtime";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

function when(fd: FormData, key: string, tz: string) {
  const v = str(fd, key);
  return v ? localInputToDate(v, tz) : null;
}

async function findPress(ctx: Ctx, number: string, ret: string) {
  if (!number) return null;
  const p = await db.asset.findFirst({ where: { AND: [pressScope(ctx), { number: { equals: number, mode: "insensitive" } }] }, select: { id: true } });
  if (!p) back(ret, `Press “${number}” not found.`);
  return p.id;
}

async function findWorkOrder(ctx: Ctx, number: string, assetId: string, ret: string) {
  if (!number) return null;
  const wo = await db.workOrder.findFirst({ where: { AND: [workOrderScope(ctx), { number: { equals: number, mode: "insensitive" } }] }, select: { id: true, assetId: true } });
  if (!wo) back(ret, `Work order “${number}” not found.`);
  if (wo.assetId !== assetId) back(ret, `Work order ${number} is for a different asset.`);
  return wo.id;
}

export async function recordDowntimeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "downtime", "create");
  const tz = ctx.org.timezone;
  const assetNo = str(fd, "asset");
  const ret = `/downtime/new?asset=${encodeURIComponent(assetNo)}`;
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: assetNo, mode: "insensitive" } }] }, select: { id: true, number: true, name: true, siteId: true, custodianPartnerId: true } });
  if (!a) back(ret, "Asset not found or not in your scope.");
  await ensureCodes(ctx.org.id);
  const code = await db.downtimeCode.findFirst({ where: { id: str(fd, "codeId"), orgId: ctx.org.id, active: true } });
  if (!code) back(ret, "Choose a reason.");
  const startedAt = when(fd, "startedAt", tz);
  if (!startedAt) back(ret, "Enter when the downtime started.");
  const endedAt = when(fd, "endedAt", tz);
  const pressId = await findPress(ctx, str(fd, "press"), ret);
  const raise = str(fd, "raiseWorkOrder") === "on";
  if (raise && !ctx.can("maintenance", "create")) back(ret, "You can't raise work orders. Record the downtime and ask maintenance to raise one.");
  if (raise && endedAt) back(ret, "A work order can only be raised while the mold is still down. Leave the end blank, or link an existing work order.");
  const linked = raise ? null : await findWorkOrder(ctx, str(fd, "workOrder"), a.id, ret);
  const description = str(fd, "description").slice(0, 2000);

  let result: { id: string; number: string; wo: { id: string; number: string } | null };
  try {
    result = await db.$transaction(async (tx) => {
      let wo: { id: string; number: string } | null = null;
      if (raise) {
        const number = await nextWorkOrderNumber(tx, ctx.org.id);
        wo = await tx.workOrder.create({
          data: {
            orgId: ctx.org.id, number, assetId: a.id, type: code.category === "planned" ? "preventive" : "corrective", title: `${code.name}: ${a.number}`, description,
            priority: code.category === "failure" ? "high" : "medium", source: "downtime", createdById: ctx.user.id, dueDate: new Date(Date.now() + 2 * 86_400_000),
            ...(ctx.isSupplier ? { assignedPartnerId: ctx.scope.partnerId } : {}),
          },
          select: { id: true, number: true },
        });
        await audit(ctx, { action: "created", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: a.number, from: "downtime", reason: code.name } }, tx);
      }
      const e = await createDowntime(tx, { orgId: ctx.org.id, userId: ctx.user.id }, {
        assetId: a.id, assetNumber: a.number, codeId: code.id, category: code.category, startedAt, endedAt, description, pressId, workOrderId: wo?.id ?? linked, source: "manual",
      });
      if (wo) await tx.workOrder.update({ where: { id: wo.id }, data: { sourceId: e.id } });
      return { id: e.id, number: e.number, wo };
    });
  } catch (e) {
    if (e instanceof DowntimeError) back(ret, e.message);
    throw e;
  }
  await emitDowntime(result.id, "downtime.started");
  if (endedAt) await emitDowntime(result.id, "downtime.ended");
  if (code.category === "failure" && !endedAt) {
    const to = await recipientsFor(ctx.org.id, "maintenance", "edit", { siteId: a.siteId, partnerIds: [a.custodianPartnerId] });
    await notify(ctx.org.id, to, { kind: "mold_down", title: `${a.number} is down: ${code.name}`, body: `${description || a.name}${result.wo ? ` · ${result.wo.number} raised` : ""}`, link: `/downtime/${result.id}` }, { exceptUserId: ctx.user.id });
  }
  back(`/downtime/${result.id}`, `${result.number} recorded${result.wo ? ` and work order ${result.wo.number} raised` : ""}.`, "ok");
}

async function loadEvent(ctx: Ctx, id: string) {
  const e = await db.downtimeEvent.findFirst({ where: { AND: [downtimeScope(ctx), { id }] }, include: { asset: { select: { id: true, number: true } }, code: true } });
  if (!e) back("/downtime", "Downtime event not found.");
  return e;
}

export async function updateDowntimeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "downtime", "edit");
  const e = await loadEvent(ctx, str(fd, "id"));
  const path = `/downtime/${e.id}`;
  const tz = ctx.org.timezone;
  const code = await db.downtimeCode.findFirst({ where: { id: str(fd, "codeId"), orgId: ctx.org.id } });
  if (!code) back(path, "Choose a reason.");
  const startedAt = when(fd, "startedAt", tz);
  if (!startedAt) back(path, "Enter when the downtime started.");
  const endedAt = when(fd, "endedAt", tz);
  const pressId = await findPress(ctx, str(fd, "press"), path);
  const workOrderId = await findWorkOrder(ctx, str(fd, "workOrder"), e.assetId, path);
  const description = str(fd, "description").slice(0, 2000);
  const reason = str(fd, "reason");
  if (reason.length < 3) back(path, "Say why you are changing this event (it is kept in the history).");
  const problem = validateDowntime({ startedAt, endedAt }, await otherEvents(db, e.assetId, e.id));
  if (problem) back(path, problem);
  const data = { codeId: code.id, category: code.id === e.codeId ? e.category : code.category, startedAt, endedAt, description, pressId, workOrderId, ...(endedAt && !e.endedAt ? { endedById: ctx.user.id } : {}) };
  await db.$transaction(async (tx) => {
    await tx.downtimeEvent.update({ where: { id: e.id }, data });
    await audit(ctx, {
      action: "downtime_edited", entityType: "downtime", entityId: e.id, entityLabel: `${e.number} ${e.asset.number}`,
      before: { code: e.code.code, startedAt: e.startedAt, endedAt: e.endedAt, description: e.description, pressId: e.pressId, workOrderId: e.workOrderId },
      after: { code: code.code, startedAt, endedAt, description, pressId, workOrderId }, reason,
    }, tx);
  });
  if (endedAt && !e.endedAt) await emitDowntime(e.id, "downtime.ended");
  back(path, `${e.number} updated.`, "ok");
}

/** The mold runs again: end an open event now (or at the time given). */
export async function endDowntimeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "downtime", "edit");
  const e = await loadEvent(ctx, str(fd, "id"));
  const ret = str(fd, "return") || `/downtime/${e.id}`;
  if (e.endedAt) back(ret, `${e.number} has already ended.`);
  const endedAt = when(fd, "endedAt", ctx.org.timezone) ?? new Date();
  const problem = validateDowntime({ startedAt: e.startedAt, endedAt }, await otherEvents(db, e.assetId, e.id));
  if (problem) back(ret, problem);
  await db.$transaction(async (tx) => {
    await tx.downtimeEvent.update({ where: { id: e.id }, data: { endedAt, endedById: ctx.user.id } });
    await audit(ctx, { action: "downtime_ended", entityType: "downtime", entityId: e.id, entityLabel: `${e.number} ${e.asset.number}`, after: { endedAt }, reason: str(fd, "note") }, tx);
  });
  await emitDowntime(e.id, "downtime.ended");
  back(ret, `${e.number} ended. ${e.asset.number} is back up.`, "ok");
}

export async function deleteDowntimeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "downtime", "delete");
  const e = await loadEvent(ctx, str(fd, "id"));
  const reason = str(fd, "reason");
  if (reason.length < 3) back(`/downtime/${e.id}`, "Say why the event is being deleted (it is kept in the history).");
  await db.$transaction(async (tx) => {
    await tx.downtimeEvent.delete({ where: { id: e.id } });
    await audit(ctx, { action: "downtime_deleted", entityType: "downtime", entityId: e.id, entityLabel: `${e.number} ${e.asset.number}`, before: { asset: e.asset.number, code: e.code.code, startedAt: e.startedAt, endedAt: e.endedAt, description: e.description }, reason }, tx);
  });
  back("/downtime", `${e.number} deleted.`, "ok");
}

// ─── Reason codes ───────────────────────────────────────────────────────────

export async function saveCodeAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "downtime", "approve");
  const path = "/downtime/codes";
  if (ctx.isSupplier) back(path, "Reason codes are managed by the organisation.");
  const id = str(fd, "id");
  const code = str(fd, "code").toUpperCase().replace(/\s+/g, "_").slice(0, 20);
  const name = str(fd, "name").slice(0, 120);
  const category = str(fd, "category");
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) back(path, "Codes use letters, numbers, - and _ (up to 20).");
  if (name.length < 3) back(path, "Give the reason a name.");
  if (!(category in DOWNTIME_CATEGORIES)) back(path, "Choose a category.");
  const clash = await db.downtimeCode.findFirst({ where: { orgId: ctx.org.id, code, ...(id ? { id: { not: id } } : {}) } });
  if (clash) back(path, `Code ${code} already exists.`);
  const active = id ? str(fd, "active") === "on" : true;
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.downtimeCode.findFirst({ where: { id, orgId: ctx.org.id } });
      if (!before) back(path, "Code not found.");
      const after = await tx.downtimeCode.update({ where: { id }, data: { code, name, category, active } });
      await audit(ctx, { action: "updated", entityType: "downtime_code", entityId: id, entityLabel: code, before, after }, tx);
    } else {
      const max = await tx.downtimeCode.aggregate({ where: { orgId: ctx.org.id }, _max: { sortOrder: true } });
      const c = await tx.downtimeCode.create({ data: { orgId: ctx.org.id, code, name, category, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
      await audit(ctx, { action: "created", entityType: "downtime_code", entityId: c.id, entityLabel: code, after: c }, tx);
    }
  });
  back(path, id ? `${code} saved. Events already recorded keep their category.` : `${code} added.`, "ok");
}

