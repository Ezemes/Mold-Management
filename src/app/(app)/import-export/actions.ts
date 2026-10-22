"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg, siteScope, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { features } from "@/lib/assets";
import { parseCsv, planAssetImport, planReadingImport, type AssetLookups, type MeterState } from "@/lib/importer";
import { afterReadings } from "@/lib/maintenance";
import { recordReading } from "@/lib/meters";
import { str, token } from "@/lib/forms";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

async function assetLookups(ctx: Ctx): Promise<AssetLookups> {
  const [types, sites, partners, existing] = await Promise.all([
    db.assetType.findMany({ where: { orgId: ctx.org.id }, include: { fields: { where: { archived: false } } } }),
    db.site.findMany({ where: siteScope(ctx) }),
    db.partner.findMany({ where: { orgId: ctx.org.id } }),
    db.asset.findMany({ where: assetScope(ctx), select: { id: true, number: true, assetTypeId: true, custodianPartnerId: true, customValues: true } }),
  ]);
  return { types, sites, partners, existing };
}

async function meterStates(ctx: Ctx): Promise<MeterState[]> {
  const meters = await db.meter.findMany({ where: { kind: "shots", asset: assetScope(ctx) }, include: { asset: { select: { number: true, designCycleTimeS: true } } } });
  return meters.map((m) => ({ meterId: m.id, assetId: m.assetId, number: m.asset.number, offset: m.offset, lastRawValue: m.lastRawValue, lastReadingAt: m.lastReadingAt, lifetimeTotal: m.lifetimeTotal, cycleTimeS: m.asset.designCycleTimeS }));
}

async function plan(ctx: Ctx, kind: string, rows: Record<string, string>[]) {
  return kind === "assets" ? planAssetImport(rows, await assetLookups(ctx)) : planReadingImport(rows, await meterStates(ctx), ctx.org.timezone);
}

export async function validateImportAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "import_export", "create");
  const kind = str(fd, "kind") === "readings" ? "readings" : "assets";
  assertCan(ctx, kind === "assets" ? "assets" : "readings", "create");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back("/import-export", "Choose a CSV file.");
  if (file.size > 5 * 1024 * 1024) back("/import-export", "CSV files must be 5 MB or smaller.");
  const parsed = parseCsv(await file.text());
  if (parsed.error) back("/import-export", parsed.error);
  if (!parsed.rows.length) back("/import-export", "The file has no data rows.");
  const required = kind === "assets" ? ["number"] : ["number", "counter", "read_at"];
  const missing = required.filter((h) => !parsed.header.includes(h));
  if (missing.length) back("/import-export", `Missing column(s): ${missing.join(", ")}. Download the template for the expected headers.`);
  const { errors } = await plan(ctx, kind, parsed.rows);
  const job = await db.importJob.create({
    data: { orgId: ctx.org.id, kind, filename: file.name.slice(0, 200), rowCount: parsed.rows.length, errorCount: errors.length, payload: parsed.rows as Prisma.InputJsonValue, errors: errors as Prisma.InputJsonValue, createdById: ctx.user.id },
  });
  redirect(`/import-export/${job.id}`);
}

export async function applyImportAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "import_export", "create");
  const job = await db.importJob.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!job) back("/import-export", "Import not found.");
  const path = `/import-export/${job.id}`;
  if (job.status !== "validated") back(path, "This import was already applied.");
  if (job.createdById !== ctx.user.id) back(path, "Only the person who uploaded the file can apply it.");
  assertCan(ctx, job.kind === "assets" ? "assets" : "readings", "create");
  // Re-plan against current data: the fleet may have changed since validation.
  const rows = job.payload as Record<string, string>[];
  const result = await plan(ctx, job.kind, rows);
  if (result.errors.length) {
    await db.importJob.update({ where: { id: job.id }, data: { errorCount: result.errors.length, errors: result.errors as Prisma.InputJsonValue } });
    back(path, "The file no longer validates against current data. Fix the rows listed and upload again.");
  }

  let created = 0;
  let updated = 0;
  await db.$transaction(
    async (tx) => {
      if (job.kind === "assets") {
        const types = await tx.assetType.findMany({ where: { orgId: ctx.org.id } });
        for (const p of result.plans as ReturnType<typeof planAssetImport>["plans"]) {
          if (p.op === "create") {
            const a = await tx.asset.create({
              data: {
                ...(p.std as Prisma.AssetUncheckedCreateInput),
                orgId: ctx.org.id, assetTypeId: p.assetTypeId, number: p.number, name: p.name, qrToken: token(12), siteId: p.siteId,
                custodianPartnerId: p.custodianPartnerId, ownerPartnerId: p.ownerPartnerId, locationDetail: p.locationDetail, program: p.program,
                customValues: p.custom as Prisma.InputJsonValue,
              },
            });
            const f = features(types.find((t) => t.id === p.assetTypeId)?.features);
            if (f.meters) await tx.meter.create({ data: { assetId: a.id, kind: "shots" } });
            if (f.cavities && a.designCavities && a.designCavities <= 256) await tx.cavity.createMany({ data: Array.from({ length: a.designCavities }, (_, i) => ({ assetId: a.id, identifier: String(i + 1) })) });
            await audit(ctx, { action: "created", entityType: "asset", entityId: a.id, entityLabel: `${a.number} ${a.name}`, after: a, reason: `CSV import ${job.filename}` }, tx);
            created++;
          } else {
            const before = await tx.asset.findUniqueOrThrow({ where: { id: p.id } });
            const after = await tx.asset.update({
              where: { id: p.id },
              data: {
                ...(p.std as Prisma.AssetUncheckedUpdateInput),
                ...(p.name ? { name: p.name } : {}), ...(p.siteId ? { siteId: p.siteId } : {}), ...(p.ownerPartnerId !== undefined ? { ownerPartnerId: p.ownerPartnerId } : {}),
                ...(p.locationDetail !== undefined ? { locationDetail: p.locationDetail } : {}), ...(p.program !== undefined ? { program: p.program } : {}),
                customValues: p.custom as Prisma.InputJsonValue,
              },
            });
            await audit(ctx, { action: "updated", entityType: "asset", entityId: p.id, entityLabel: `${after.number} ${after.name}`, before, after, reason: `CSV import ${job.filename}` }, tx);
            updated++;
          }
        }
      } else {
        for (const p of result.plans as ReturnType<typeof planReadingImport>["plans"]) {
          const meter = await tx.meter.findUniqueOrThrow({ where: { id: p.meterId }, include: { asset: { select: { designCycleTimeS: true } } } });
          const r = await recordReading(tx, meter, { rawValue: p.rawValue, readAt: p.readAt, source: "import", isReset: p.isReset, resetReason: p.resetReason, note: p.note, enteredById: ctx.user.id, cycleTimeS: meter.asset.designCycleTimeS });
          await audit(ctx, { action: r.isReset ? "counter_reset" : "reading_recorded", entityType: "asset", entityId: p.assetId, entityLabel: p.number, after: { raw: r.rawValue, lifetime: r.lifetime, delta: r.delta, readAt: r.readAt }, reason: `CSV import ${job.filename}` }, tx);
          created++;
        }
      }
      await tx.importJob.update({ where: { id: job.id }, data: { status: "applied", appliedAt: new Date() } });
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  if (job.kind !== "assets") await afterReadings(ctx.org.id, [...new Set((result.plans as ReturnType<typeof planReadingImport>["plans"]).map((p) => p.assetId))]);
  back(path, job.kind === "assets" ? `Imported: ${created} created, ${updated} updated.` : `Imported ${created} readings.`, "ok");
}
