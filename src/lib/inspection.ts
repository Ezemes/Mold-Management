import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { DEFAULT_TEMPLATES, pickTemplate, type Component } from "./inspection.pure";
import { criteriaFor } from "./quality";

export * from "./inspection.pure";

/** Give an organisation its own copies of the standard templates the first time they are needed. */
export async function ensureTemplates(orgId: string) {
  if (await db.inspectionTemplate.count({ where: { orgId } })) return;
  await db.inspectionTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((t) => ({ orgId, name: t.name, processes: t.processes, isDefault: t.isDefault, components: t.components as unknown as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });
}

/** The template for an asset (by its process), falling back to the asset type's weighted criteria. */
export async function templateForAsset(orgId: string, a: { process: string; assetType: { kind: string; evalCriteria: unknown } }) {
  await ensureTemplates(orgId);
  const t = pickTemplate(await db.inspectionTemplate.findMany({ where: { orgId } }), a.process);
  if (t) return { id: t.id as string | null, name: t.name, components: t.components as unknown as Component[] };
  return { id: null, name: "Condition criteria", components: criteriaFor(a.assetType).map((c) => ({ ...c, checks: [] })) };
}
