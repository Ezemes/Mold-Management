"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify, recipientsFor } from "@/lib/notify";
import { AttachmentError, storeUploads } from "@/lib/attachments";
import { recordReading, ReadingError } from "@/lib/meters";
import { afterReadings } from "@/lib/maintenance";
import { str } from "@/lib/forms";
import { weightedScore } from "@/lib/quality";
import { ratingWord, templateForAsset, validateAssessment, SPARE_PARTS_STATUS, type Answers, type ComponentResult } from "@/lib/inspection";

export type AssessState = { errors?: string[] };

const yesNo = (v: string) => (v === "yes" ? true : v === "no" ? false : null);
const int = (v: string) => { const n = Number(v.replace(/,/g, "")); return v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null; };

/**
 * Submit a guided assessment (Workflow-based Inspection). Everything the wizard checks is checked again here.
 * Photos are stored per component; a bench video is stored with the evaluation. A total-shots figure is
 * recorded as a counter reading straight away; production data is applied to the passport on approval.
 */
export async function submitAssessmentAction(_prev: AssessState, fd: FormData): Promise<AssessState> {
  const ctx = await requireOrg();
  assertCan(ctx, "quality", "create");
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { id: str(fd, "assetId") }] }, include: { assetType: true, meters: true } });
  if (!a) return { errors: ["Asset not found or not in your scope."] };
  const template = await templateForAsset(ctx.org.id, a);
  const photos = new Map(template.components.map((c) => [c.key, fd.getAll(`p.${c.key}`).filter((f): f is File => f instanceof File && f.size > 0)]));
  const results: ComponentResult[] = template.components.map((c) => {
    const r = str(fd, `r.${c.key}`);
    return {
      ...c,
      score: r === "na" ? null : r === "" ? (undefined as unknown as null) : Number(r),
      note: str(fd, `n.${c.key}`).slice(0, 1000),
      checkResults: c.checks.map((text, i) => ({ text, ok: yesNo(str(fd, `c.${c.key}.${i}`)) })),
      photos: photos.get(c.key)!.length,
    };
  });
  const mode = str(fd, "mode") === "machine" ? "machine" : "bench";
  const sp = str(fd, "spareParts");
  const answers: Answers = {
    mode,
    dynamic: { cavitiesRunning: int(str(fd, "cavitiesRunning")), cavitiesTotal: a.designCavities, lastRunDate: str(fd, "lastRunDate") || null, totalShots: int(str(fd, "totalShots")), annualVolume: int(str(fd, "annualVolume")) },
    qualityIssues: yesNo(str(fd, "qualityIssues")), qualityNote: str(fd, "qualityNote"),
    operationalIssues: yesNo(str(fd, "operationalIssues")), operationalNote: str(fd, "operationalNote"),
    spareParts: sp in SPARE_PARTS_STATUS ? (sp as Answers["spareParts"]) : null, sparePartsNote: str(fd, "sparePartsNote"),
    supplyRisk: yesNo(str(fd, "supplyRisk")), supplyRiskNote: str(fd, "supplyRiskNote"),
    overallCondition: str(fd, "overallCondition").slice(0, 4000), recommendations: str(fd, "recommendations").slice(0, 4000),
    video: false,
  };
  const errors = validateAssessment(results, answers);
  if (answers.dynamic.lastRunDate && isNaN(new Date(answers.dynamic.lastRunDate).getTime())) errors.push("Last run date is not a valid date.");
  const meter = a.meters.find((m) => m.kind === "shots");
  if (answers.dynamic.totalShots != null && meter?.lastRawValue != null && answers.dynamic.totalShots < meter.lastRawValue) errors.push(`Total shots (${answers.dynamic.totalShots.toLocaleString("en-IN")}) is below the last counter reading (${meter.lastRawValue.toLocaleString("en-IN")}). If the counter was reset, record it on the passport first.`);
  const score = weightedScore(results.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score: c.score })));
  if (score == null) errors.push("Rate at least one component (not everything can be N/A).");
  if (errors.length) return { errors };

  // Store files before the transaction (a failed upload changes nothing).
  const stored = new Map<string, Awaited<ReturnType<typeof storeUploads>>>();
  let video: Awaited<ReturnType<typeof storeUploads>> = [];
  try {
    for (const [k, files] of photos) stored.set(k, await storeUploads(ctx.org.id, files, 10));
    stored.set("_general", await storeUploads(ctx.org.id, fd.getAll("photos"), 10));
    if (mode === "bench") video = await storeUploads(ctx.org.id, fd.getAll("video"), 1, { video: true });
  } catch (e) {
    if (e instanceof AttachmentError) return { errors: [e.message] };
    throw e;
  }
  answers.video = video.length > 0;
  let readingError = "";
  const ev = await db.$transaction(async (tx) => {
    const ev = await tx.conditionEvaluation.create({
      data: {
        orgId: ctx.org.id, assetId: a.id, templateId: template.id, mode, score: score!, notes: answers.overallCondition, evaluatedById: ctx.user.id,
        shots: answers.dynamic.totalShots ?? meter?.lifetimeTotal ?? null, scores: [] as Prisma.InputJsonValue, answers: answers as unknown as Prisma.InputJsonValue,
      },
    });
    // Attachments are linked per component through their ids, kept with the component result.
    const withPhotos: (ComponentResult & { photoIds: string[] })[] = [];
    for (const c of results) {
      const rows = stored.get(c.key) ?? [];
      const ids: string[] = [];
      for (const r of rows) ids.push((await tx.attachment.create({ data: { ...r, orgId: ctx.org.id, ownerType: "evaluation", ownerId: ev.id, uploadedById: ctx.user.id } })).id);
      withPhotos.push({ ...c, photoIds: ids });
    }
    for (const r of [...(stored.get("_general") ?? []), ...video]) await tx.attachment.create({ data: { ...r, orgId: ctx.org.id, ownerType: "evaluation", ownerId: ev.id, uploadedById: ctx.user.id } });
    await tx.conditionEvaluation.update({ where: { id: ev.id }, data: { scores: withPhotos as unknown as Prisma.InputJsonValue } });
    if (answers.dynamic.totalShots != null && meter && answers.dynamic.totalShots !== meter.lastRawValue) {
      try {
        await recordReading(tx, meter, { rawValue: answers.dynamic.totalShots, readAt: new Date(), source: "manual", note: "Condition assessment", enteredById: ctx.user.id, confirmHigh: true, cycleTimeS: a.designCycleTimeS });
      } catch (e) {
        if (!(e instanceof ReadingError)) throw e;
        readingError = e.message;
      }
    }
    await audit(ctx, { action: "evaluation_submitted", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: { evaluation: ev.id, score, template: template.name, mode, unacceptable: results.filter((c) => c.score === 1).map((c) => c.label) } }, tx);
    return ev;
  });
  if (answers.dynamic.totalShots != null && !readingError) await afterReadings(ctx.org.id, [a.id]);
  const approvers = await recipientsFor(ctx.org.id, "quality", "approve", { siteId: a.siteId });
  const unacceptable = results.filter((c) => c.score === 1);
  if (unacceptable.length) {
    // "Should not run until corrected": tell approvers and maintenance now, not only when approved.
    const maint = await recipientsFor(ctx.org.id, "maintenance", "create", { siteId: a.siteId });
    await notify(ctx.org.id, [...approvers, ...maint], { kind: "unacceptable_condition", title: `Unacceptable condition reported on ${a.number}`, body: `${unacceptable.map((c) => c.label).join(", ")} rated ${ratingWord(1)}. The tool should not run until corrected.`, link: `/quality/evaluations/${ev.id}` }, { exceptUserId: ctx.user.id });
  }
  await notify(ctx.org.id, approvers, { kind: "evaluation_submitted", title: `Approve assessment: ${a.number}`, body: `Weighted score ${score!.toFixed(2)} of 5 (${template.name}).`, link: `/quality/evaluations/${ev.id}` }, { exceptUserId: ctx.user.id });
  redirect(`/quality/evaluations/${ev.id}?ok=${encodeURIComponent(`Assessment submitted (score ${score!.toFixed(2)}).${readingError ? ` The total-shots reading was not recorded: ${readingError}` : ""}`)}`);
}
