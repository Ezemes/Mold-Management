import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { notify, recipientsFor } from "./notify";
import { nextWorkOrderNumber } from "./work-orders";
import { planState, OPEN_WO, type TaskDef, type TaskResult } from "./maintenance.pure";

export * from "./maintenance.pure";
export { nextWorkOrderNumber, workOrderScope } from "./work-orders";

const KIND_TO_TYPE: Record<string, string> = { preventive: "preventive", inspection: "inspection", refurbishment: "refurbishment" };

export function checklistFromTemplate(tasks: unknown): TaskResult[] {
  return ((tasks ?? []) as TaskDef[]).map((t) => ({ ...t, result: null, value: null, note: "" }));
}

/**
 * Check every active plan on the given assets (or the whole org). Warn once at the lead percentage;
 * when due, raise one work order (never a second while one is open). Returns counts.
 */
export async function evaluatePlans(orgId: string, assetIds?: string[], now = new Date()) {
  const plans = await db.maintenancePlan.findMany({
    where: { orgId, active: true, ...(assetIds ? { assetId: { in: assetIds } } : {}), asset: { deletedAt: null, status: { notIn: ["retired", "scrapped"] } } },
    include: { template: true, asset: { include: { meters: true, site: true } }, workOrders: { where: { status: { in: OPEN_WO } }, select: { id: true } } },
  });
  let raised = 0;
  let warned = 0;
  for (const p of plans) {
    const shots = p.asset.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null;
    const st = planState(p, shots, now);
    const link = `/assets/${p.assetId}?tab=maintenance`;
    const who = () => recipientsFor(orgId, "maintenance", "edit", { siteId: p.asset.siteId, partnerIds: [p.asset.custodianPartnerId] });
    if (st.status === "due" && p.workOrders.length === 0) {
      const wo = await db.$transaction(async (tx) => {
        const number = await nextWorkOrderNumber(tx, orgId);
        const wo = await tx.workOrder.create({
          data: {
            orgId, number, assetId: p.assetId, type: KIND_TO_TYPE[p.template.kind] ?? "preventive", title: `${p.template.name}`, description: p.template.description,
            planId: p.id, templateId: p.templateId, source: "trigger", sourceId: p.id, priority: p.template.kind === "refurbishment" ? "high" : "medium",
            dueDate: st.unit === "days" ? st.dueDate : new Date(now.getTime() + 7 * 86_400_000), dueAtShots: st.dueAtShots,
            checklist: checklistFromTemplate(p.template.tasks) as unknown as Prisma.InputJsonValue,
            assignedPartnerId: p.asset.custodianPartnerId,
          },
        });
        await audit({ orgId, userId: null }, { action: "raised_by_trigger", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: p.asset.number, plan: p.template.name, trigger: `${p.interval} ${st.unit}`, shots } }, tx);
        return wo;
      });
      raised++;
      await notify(orgId, await who(), { kind: "pm_due", title: `${p.template.name} due: ${p.asset.number}`, body: `${wo.number} raised. ${st.unit === "shots" ? `Due at ${st.dueAtShots?.toLocaleString("en-IN")} shots (now ${shots?.toLocaleString("en-IN")}).` : `Due ${st.dueDate?.toISOString().slice(0, 10)}.`}`, link: `/maintenance/work-orders/${wo.id}`, dedupeKey: `pm-due:${wo.id}` });
    } else if (st.status === "due_soon" && (!p.warnedAt || p.warnedAt < p.baselineDate)) {
      await db.maintenancePlan.update({ where: { id: p.id }, data: { warnedAt: now } });
      warned++;
      await notify(orgId, await who(), { kind: "pm_due_soon", title: `${p.template.name} coming up: ${p.asset.number}`, body: st.unit === "shots" ? `${st.remaining.toLocaleString("en-IN")} shots to go (${Math.round(st.progress * 100)}% of interval).` : `Due in ${st.remaining} day(s).`, link, dedupeKey: `pm-soon:${p.id}:${p.baselineDate.toISOString()}` });
    }
  }
  return { plans: plans.length, raised, warned };
}

/** Life-threshold alerts after shots change (80% / 95% of warranty and end-of-life). */
export async function lifeAlerts(orgId: string, assetId: string) {
  const a = await db.asset.findUnique({ where: { id: assetId }, include: { meters: true } });
  const shots = a?.meters.find((m) => m.kind === "shots")?.lifetimeTotal;
  if (!a || shots == null) return;
  for (const [limit, name] of [[a.warrantyShots, "warranty"], [a.endOfLifeShots, "end-of-life"]] as const) {
    if (!limit) continue;
    for (const pct of [95, 80]) {
      if (shots >= (limit * pct) / 100) {
        const users = await recipientsFor(orgId, "assets", "edit", { siteId: a.siteId });
        await notify(orgId, users, { kind: "life_threshold", title: `${a.number} reached ${pct}% of ${name} shots`, body: `${shots.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} shots.`, link: `/assets/${a.id}`, dedupeKey: `life:${a.id}:${name}:${pct}` });
        break;
      }
    }
  }
}

export function woCost(wo: { externalCost: Prisma.Decimal | number; labor: { hours: number; rate: Prisma.Decimal | number }[]; parts: { quantity: number; unitCost: Prisma.Decimal | number }[] }) {
  const n = (v: Prisma.Decimal | number) => Number(v);
  const labor = wo.labor.reduce((s, l) => s + l.hours * n(l.rate), 0);
  const parts = wo.parts.reduce((s, p) => s + p.quantity * n(p.unitCost), 0);
  return { labor, parts, external: n(wo.externalCost), total: labor + parts + n(wo.externalCost), hours: wo.labor.reduce((s, l) => s + l.hours, 0) };
}

/** Run after any shot readings are recorded: maintenance triggers, then life thresholds. Never blocks the caller. */
export async function afterReadings(orgId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  try {
    await evaluatePlans(orgId, assetIds);
    for (const id of assetIds.slice(0, 500)) await lifeAlerts(orgId, id);
  } catch (e) {
    console.error("afterReadings failed", e);
  }
}

/** Quarantine raises an inspection work order; only completing it releases the asset. */
export async function raiseQuarantineWorkOrder(tx: Prisma.TransactionClient, ctx: { org: { id: string }; user: { id: string } }, a: { id: string; number: string; name: string; custodianPartnerId: string | null }, reason: string) {
  const number = await nextWorkOrderNumber(tx, ctx.org.id);
  const wo = await tx.workOrder.create({
    data: {
      orgId: ctx.org.id, number, assetId: a.id, type: "inspection", title: `Quarantine release: ${a.number}`, description: reason, priority: "high", source: "quarantine",
      clearsQuarantine: true, createdById: ctx.user.id, dueDate: new Date(Date.now() + 3 * 86_400_000),
      checklist: [
        { id: "q1", text: "Cause of quarantine investigated", type: "check", required: true, result: null, value: null, note: "" },
        { id: "q2", text: "Corrective action taken or not needed", type: "check", required: true, result: null, value: null, note: "" },
        { id: "q3", text: "Mold safe to return to production", type: "check", required: true, result: null, value: null, note: "" },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, { action: "created", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: a.number, from: "quarantine" }, reason }, tx);
  return wo;
}
