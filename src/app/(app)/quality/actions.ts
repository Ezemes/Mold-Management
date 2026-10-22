"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify, recipientsFor } from "@/lib/notify";
import { parseDate } from "@/lib/asset-values";
import { str } from "@/lib/forms";
import { nextWorkOrderNumber } from "@/lib/work-orders";
import { checkCompat, normalizeRules, pressScope } from "@/lib/compat";
import { currentStage, nextQualificationNumber, qualificationOutcome, QUAL_STAGES } from "@/lib/quality";
import { assessmentOutcome, parseComponents, ratingWord, type Answers, type ComponentResult } from "@/lib/inspection";
import { raiseQuarantineWorkOrder } from "@/lib/maintenance";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

const DAY = 86_400_000;

function internalOnly(ctx: Ctx, path: string) {
  if (ctx.isSupplier) back(path, "This decision is made by the organisation.");
}

// ─── Condition evaluations ──────────────────────────────────────────────────

async function loadEvaluation(ctx: Ctx, id: string) {
  const ev = await db.conditionEvaluation.findFirst({ where: { id, orgId: ctx.org.id, asset: assetScope(ctx) }, include: { asset: { include: { assetType: true } } } });
  if (!ev) back("/quality", "Evaluation not found.");
  return ev;
}

/**
 * Approving applies the assessment: the condition score and next evaluation date go on the passport,
 * captured production data (annual volume, last run date) updates the passport, and the outcome follows
 * the Mold Health Rating — any Unacceptable component quarantines the mold (the release work order is
 * the repair order); Poor components, reported issues or a low score raise a corrective work order.
 */
export async function approveEvaluationAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  const ev = await loadEvaluation(ctx, str(fd, "id"));
  const path = `/quality/evaluations/${ev.id}`;
  internalOnly(ctx, path);
  if (ev.status !== "submitted") back(path, "This evaluation has already been decided.");
  const a = ev.asset;
  const threshold = a.assetType.evalThreshold;
  const results = ev.scores as unknown as ComponentResult[];
  const answers = ev.answers as unknown as Partial<Answers>;
  const outcome = assessmentOutcome(results, { qualityIssues: answers.qualityIssues ?? null, operationalIssues: answers.operationalIssues ?? null, spareParts: answers.spareParts ?? null, supplyRisk: answers.supplyRisk ?? null }, ev.score, threshold);
  const now = new Date();
  const lastRun = answers.dynamic?.lastRunDate ? new Date(answers.dynamic.lastRunDate) : null;
  const assetData = {
    conditionScore: ev.score, conditionDate: ev.evaluatedAt, nextEvaluationDate: new Date(ev.evaluatedAt.getTime() + a.assetType.evalIntervalDays * DAY),
    ...(answers.dynamic?.annualVolume != null ? { annualVolume: answers.dynamic.annualVolume } : {}),
    ...(lastRun && !isNaN(lastRun.getTime()) ? { lastRunDate: lastRun } : {}),
  };
  const problems = results.filter((c) => c.score != null && c.score <= 2).map((c) => `• ${c.label}: ${ratingWord(c.score)}${c.note ? ` — ${c.note}` : ""}`);
  const issues = [answers.qualityIssues && `• Quality issues: ${answers.qualityNote}`, answers.operationalIssues && `• Operational issues: ${answers.operationalNote}`, answers.supplyRisk && `• Supply risk: ${answers.supplyRiskNote}`].filter(Boolean) as string[];
  const wo = await db.$transaction(async (tx) => {
    let wo: { id: string; number: string } | null = null;
    if (outcome.stopTool && a.status !== "quarantined") {
      await tx.asset.update({ where: { id: a.id }, data: { status: "quarantined" } });
      await audit(ctx, { action: "status_changed", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { status: a.status }, after: { status: "quarantined" }, reason: `Condition assessment: ${outcome.reasons[0]}` }, tx);
      wo = await raiseQuarantineWorkOrder(tx, ctx, a, `Unacceptable condition in assessment of ${ev.evaluatedAt.toISOString().slice(0, 10)}:\n${[...problems, ...issues].join("\n")}`);
    } else if (outcome.workOrderRequired) {
      const number = await nextWorkOrderNumber(tx, ctx.org.id);
      wo = await tx.workOrder.create({
        data: {
          orgId: ctx.org.id, number, assetId: a.id, type: "corrective", priority: "high", source: "evaluation", sourceId: ev.id, createdById: ctx.user.id,
          title: `Condition assessment: ${outcome.reasons[0]}`.slice(0, 200),
          description: [...problems, ...issues, ...(ev.score < threshold ? [`• Weighted score ${ev.score.toFixed(2)} (threshold ${threshold})`] : [])].join("\n"),
          dueDate: new Date(now.getTime() + 14 * DAY), assignedPartnerId: a.custodianPartnerId,
        },
      });
      await audit(ctx, { action: "created", entityType: "work_order", entityId: wo.id, entityLabel: number, after: { asset: a.number, from: "condition assessment", reasons: outcome.reasons } }, tx);
    }
    await tx.conditionEvaluation.update({ where: { id: ev.id }, data: { status: "approved", decidedById: ctx.user.id, decidedAt: now, workOrderId: wo?.id ?? null } });
    await tx.asset.update({ where: { id: a.id }, data: assetData });
    await audit(ctx, { action: "evaluation_approved", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, before: { conditionScore: a.conditionScore, annualVolume: a.annualVolume, lastRunDate: a.lastRunDate }, after: { ...assetData, workOrder: wo?.number, outcome: outcome.reasons } }, tx);
    return wo;
  });
  const link = wo ? `/maintenance/work-orders/${wo.id}` : path;
  if (wo) await notify(ctx.org.id, await recipientsFor(ctx.org.id, "maintenance", "create", { siteId: a.siteId, partnerIds: [a.custodianPartnerId] }), { kind: "wo_assigned", title: `${wo.number}: ${outcome.stopTool ? "mold quarantined" : "repair needed"} on ${a.number}`, body: outcome.reasons.join("; "), link }, { exceptUserId: ctx.user.id });
  if (outcome.sparePartsNeeded) await notify(ctx.org.id, await recipientsFor(ctx.org.id, "inventory", "edit", { siteId: a.siteId }), { kind: "spare_parts_needed", title: `Spare parts needed for ${a.number}`, body: answers.sparePartsNote ?? "", link: path, dedupeKey: `spares:${ev.id}` }, { exceptUserId: ctx.user.id });
  if (ev.evaluatedById && ev.evaluatedById !== ctx.user.id) await notify(ctx.org.id, [ev.evaluatedById], { kind: "evaluation_approved", title: `Assessment of ${a.number} approved`, link: path });
  back(path, outcome.stopTool ? `Approved. ${a.number} is quarantined (Unacceptable rating); release work order ${wo?.number ?? ""} must be completed before it runs.` : wo ? `Approved. Work order ${wo.number} raised: ${outcome.reasons.join("; ")}.` : "Approved. The passport shows the new condition score.", "ok");
}

export async function rejectEvaluationAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  const ev = await loadEvaluation(ctx, str(fd, "id"));
  const path = `/quality/evaluations/${ev.id}`;
  internalOnly(ctx, path);
  if (ev.status !== "submitted") back(path, "This evaluation has already been decided.");
  const reason = str(fd, "reason");
  if (reason.length < 3) back(path, "Give a reason for rejecting.");
  await db.$transaction(async (tx) => {
    await tx.conditionEvaluation.update({ where: { id: ev.id }, data: { status: "rejected", decidedById: ctx.user.id, decidedAt: new Date(), rejectReason: reason } });
    await audit(ctx, { action: "evaluation_rejected", entityType: "asset", entityId: ev.assetId, entityLabel: `${ev.asset.number} ${ev.asset.name}`, reason }, tx);
  });
  if (ev.evaluatedById && ev.evaluatedById !== ctx.user.id) await notify(ctx.org.id, [ev.evaluatedById], { kind: "evaluation_rejected", title: `Evaluation of ${ev.asset.number} rejected`, body: reason, link: path });
  back(path, "Rejected. The evaluator has been told why.", "ok");
}

export async function saveEvalSettingsAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  internalOnly(ctx, "/quality/templates");
  const t = await db.assetType.findFirst({ where: { id: str(fd, "assetTypeId"), orgId: ctx.org.id } });
  if (!t) back("/quality/templates", "Asset type not found.");
  const threshold = Number(str(fd, "threshold"));
  if (!(threshold >= 1 && threshold <= 5)) back("/quality/templates", "The threshold must be between 1 and 5.");
  const interval = Number(str(fd, "interval"));
  if (!Number.isInteger(interval) || interval < 7 || interval > 3650) back("/quality/templates", "Evaluate every 7 to 3,650 days.");
  await db.$transaction(async (tx) => {
    await tx.assetType.update({ where: { id: t.id }, data: { evalThreshold: threshold, evalIntervalDays: interval } });
    await audit(ctx, { action: "evaluation_settings_updated", entityType: "asset_type", entityId: t.id, entityLabel: t.name, before: { threshold: t.evalThreshold, interval: t.evalIntervalDays }, after: { threshold, interval } }, tx);
  });
  back("/quality/templates", `${t.name}: threshold ${threshold}, every ${interval} days.`, "ok");
}

export async function saveTemplateAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  internalOnly(ctx, "/quality/templates");
  const id = str(fd, "id");
  const ret = id ? `/quality/templates?edit=${id}` : "/quality/templates?edit=new";
  const name = str(fd, "name");
  if (name.length < 2) back(ret, "Name the template.");
  const { components, errors } = parseComponents(str(fd, "components"));
  if (errors.length) back(ret, errors.slice(0, 3).join(" "));
  const processes = [...new Set(str(fd, "processes").split(",").map((p) => p.trim()).filter(Boolean))];
  const isDefault = str(fd, "isDefault") === "on";
  const active = str(fd, "active") === "on";
  const existing = id ? await db.inspectionTemplate.findFirst({ where: { id, orgId: ctx.org.id } }) : null;
  if (id && !existing) back("/quality/templates", "Template not found.");
  const dup = await db.inspectionTemplate.findFirst({ where: { orgId: ctx.org.id, name: { equals: name, mode: "insensitive" }, NOT: id ? { id } : undefined } });
  if (dup) back(ret, `A template called “${dup.name}” already exists.`);
  const data = { name, processes, isDefault, active, components: components as unknown as Prisma.InputJsonValue };
  await db.$transaction(async (tx) => {
    // Only one default template.
    if (isDefault) await tx.inspectionTemplate.updateMany({ where: { orgId: ctx.org.id, NOT: id ? { id } : undefined }, data: { isDefault: false } });
    const t = existing ? await tx.inspectionTemplate.update({ where: { id: existing.id }, data }) : await tx.inspectionTemplate.create({ data: { ...data, orgId: ctx.org.id } });
    await audit(ctx, { action: existing ? "inspection_template_updated" : "inspection_template_created", entityType: "inspection_template", entityId: t.id, entityLabel: name, before: existing ? { components: existing.components, processes: existing.processes } : undefined, after: { components, processes, isDefault, active } }, tx);
  });
  back("/quality/templates", `Template “${name}” saved. It applies to assessments started from now on.`, "ok");
}

// ─── Qualifications ─────────────────────────────────────────────────────────

export async function createQualificationAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "create");
  const ret = `/quality/qualifications/new?asset=${encodeURIComponent(str(fd, "asset"))}`;
  internalOnly(ctx, ret);
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: str(fd, "asset"), mode: "insensitive" }, assetType: { kind: "mold" } }] } });
  if (!a) back(ret, "Mold not found or not in your scope.");
  const open = await db.qualification.findFirst({ where: { assetId: a.id, status: "in_progress" } });
  if (open) back(`/quality/qualifications/${open.id}`, `${a.number} already has qualification ${open.number} in progress.`);
  let press = null;
  if (str(fd, "press")) {
    press = await db.asset.findFirst({ where: { AND: [pressScope(ctx), { number: { equals: str(fd, "press"), mode: "insensitive" } }] } });
    if (!press) back(ret, "Press not found.");
    const v = checkCompat(a, press, normalizeRules(ctx.org.compatRules));
    if (!v.compatible) back(ret, `${press.number} is not compatible with ${a.number}: ${v.failures.map((f) => `${f.label} (${f.detail})`).join("; ")}.`);
  }
  const owners = Object.fromEntries(QUAL_STAGES.map((s) => [s, str(fd, `${s}.owner`) || null]));
  const dates: Record<string, Date | null> = {};
  for (const s of QUAL_STAGES) {
    const d = str(fd, `${s}.planned`) ? parseDate(str(fd, `${s}.planned`), `${s} planned date`) : ({ ok: true, value: null } as const);
    if (!d.ok) back(ret, d.error);
    dates[s] = d.value;
  }
  const ownerIds = Object.values(owners).filter((x): x is string => !!x);
  if (ownerIds.length && (await db.membership.count({ where: { orgId: ctx.org.id, userId: { in: ownerIds }, status: "active" } })) !== new Set(ownerIds).size) back(ret, "Choose stage owners from your organisation.");
  const kind = a.requalificationReason ? "requalification" : str(fd, "kind") === "requalification" ? "requalification" : "initial";
  const q = await db.$transaction(async (tx) => {
    const number = await nextQualificationNumber(tx, ctx.org.id);
    const q = await tx.qualification.create({
      data: {
        orgId: ctx.org.id, number, assetId: a.id, pressId: press?.id ?? null, siteId: a.siteId, kind, reason: str(fd, "reason") || a.requalificationReason, createdById: ctx.user.id,
        stages: { create: QUAL_STAGES.map((s) => ({ stage: s, ownerId: owners[s], plannedDate: dates[s] })) },
      },
    });
    await audit(ctx, { action: "qualification_started", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { qualification: number, press: press?.number, kind } }, tx);
    return q;
  });
  await notify(ctx.org.id, ownerIds, { kind: "qualification_owner", title: `${q.number}: you own a qualification stage for ${a.number}`, link: `/quality/qualifications/${q.id}` }, { exceptUserId: ctx.user.id });
  back(`/quality/qualifications/${q.id}`, `Qualification ${q.number} started.`, "ok");
}

async function loadQualification(ctx: Ctx, id: string) {
  const q = await db.qualification.findFirst({ where: { id, orgId: ctx.org.id, asset: assetScope(ctx) }, include: { stages: true, asset: true, press: true } });
  if (!q) back("/quality/qualifications", "Qualification not found.");
  return q;
}

async function stageStep(fd: FormData, step: "start" | "pass" | "fail") {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", step === "start" ? "edit" : "approve");
  const q = await loadQualification(ctx, str(fd, "id"));
  const path = `/quality/qualifications/${q.id}`;
  internalOnly(ctx, path);
  if (q.status !== "in_progress") back(path, "This qualification is closed.");
  const stageName = currentStage(q.stages);
  const stage = q.stages.find((s) => s.stage === stageName);
  if (!stage || stage.stage !== str(fd, "stage")) back(path, "That stage is not open. Stages run IQ → OQ → PQ.");
  const result = str(fd, "result");
  if (step !== "start" && result.length < 5) back(path, `Record the ${stage.stage} result (what was checked and the outcome).`);
  const actual = str(fd, "actualDate") ? parseDate(str(fd, "actualDate"), "Actual date") : ({ ok: true, value: new Date() } as const);
  if (!actual.ok) back(path, actual.error);
  const workOrderId = str(fd, "workOrderId") || null;
  if (workOrderId && !(await db.workOrder.findFirst({ where: { id: workOrderId, assetId: q.assetId } }))) back(path, "Link a work order on this mold.");
  const status = step === "start" ? "in_progress" : step === "pass" ? "passed" : "failed";
  const stages = q.stages.map((s) => (s.id === stage.id ? { ...s, status } : s));
  const outcome = qualificationOutcome(stages);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.qualificationStage.update({
      where: { id: stage.id },
      data: step === "start" ? { status } : { status, result, actualDate: actual.value, approvedById: ctx.user.id, approvedAt: now, ...(workOrderId ? { workOrderId } : {}) },
    });
    await audit(ctx, { action: `stage_${status}`, entityType: "qualification", entityId: q.id, entityLabel: `${q.number} ${stage.stage}`, after: { asset: q.asset.number, result }, reason: result }, tx);
    if (outcome !== "in_progress") {
      await tx.qualification.update({ where: { id: q.id }, data: { status: outcome, closedAt: now } });
      if (outcome === "passed") {
        if (q.pressId) {
          await tx.moldPress.upsert({
            where: { moldId_pressId: { moldId: q.assetId, pressId: q.pressId } },
            create: { orgId: ctx.org.id, moldId: q.assetId, pressId: q.pressId, qualificationId: q.id, approvedById: ctx.user.id, notes: result },
            update: { status: "approved", qualificationId: q.id, approvedById: ctx.user.id, approvedAt: now, revokedReason: "", notes: result },
          });
        }
        await tx.asset.update({ where: { id: q.assetId }, data: { requalificationReason: "" } });
      }
      await audit(ctx, { action: `qualification_${outcome}`, entityType: "asset", entityId: q.assetId, entityLabel: `${q.asset.number} ${q.asset.name}`, after: { qualification: q.number, press: q.press?.number } }, tx);
    }
  });
  if (q.createdById && q.createdById !== ctx.user.id && outcome !== "in_progress") await notify(ctx.org.id, [q.createdById], { kind: `qualification_${outcome}`, title: `${q.number} ${outcome} for ${q.asset.number}`, link: path });
  back(
    path,
    outcome === "passed" ? `PQ passed. ${q.press ? `${q.asset.number} is now approved on ${q.press.number}.` : "Qualification complete."}` : outcome === "failed" ? `${stage.stage} failed; the qualification is closed as failed. Start a new one after corrective action.` : step === "start" ? `${stage.stage} started.` : `${stage.stage} passed.`,
    outcome === "failed" ? "error" : "ok",
  );
}

export async function startStageAction(fd: FormData) {
  await stageStep(fd, "start");
}
export async function passStageAction(fd: FormData) {
  await stageStep(fd, "pass");
}
export async function failStageAction(fd: FormData) {
  await stageStep(fd, "fail");
}

export async function cancelQualificationAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "approve");
  const q = await loadQualification(ctx, str(fd, "id"));
  const path = `/quality/qualifications/${q.id}`;
  internalOnly(ctx, path);
  if (q.status !== "in_progress") back(path, "This qualification is closed.");
  const reason = str(fd, "reason");
  if (reason.length < 3) back(path, "Give a reason for cancelling.");
  await db.$transaction(async (tx) => {
    await tx.qualification.update({ where: { id: q.id }, data: { status: "cancelled", closedAt: new Date() } });
    await audit(ctx, { action: "qualification_cancelled", entityType: "qualification", entityId: q.id, entityLabel: q.number, reason }, tx);
  });
  back(path, "Qualification cancelled.", "ok");
}
