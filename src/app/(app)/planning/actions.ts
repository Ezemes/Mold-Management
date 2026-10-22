"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/forms";
import { BUDGET_CATEGORIES, budgetFromRules, fleetForecast, monthStart, normalizeBudgetRules, parseMonth } from "@/lib/planning";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

/** Paste or upload "part_number,month,quantity" rows (month as YYYY-MM or MM-YYYY). Quantity 0 removes a month. */
export async function importDemandAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "planning", "edit");
  const ret = "/planning/capacity";
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : str(fd, "rows");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /part/i.test(lines[0])) lines.shift();
  if (!lines.length) back(ret, "Paste demand rows: part_number, month, quantity.");
  if (lines.length > 20_000) back(ret, "At most 20,000 rows per import.");
  const errors: string[] = [];
  const rows: { partNumber: string; month: string; quantity: number }[] = [];
  lines.forEach((line, i) => {
    const [part, month, qty] = line.split(/[,;\t]/).map((x) => x?.trim().replace(/^"|"$/g, "") ?? "");
    const m = parseMonth(month);
    const q = Number(qty.replace(/[\s,]/g, ""));
    if (!part) errors.push(`Row ${i + 1}: part number missing`);
    else if (!m) errors.push(`Row ${i + 1}: month “${month}” should be YYYY-MM`);
    else if (!Number.isInteger(q) || q < 0) errors.push(`Row ${i + 1}: quantity “${qty}” should be a whole number`);
    else rows.push({ partNumber: part.toUpperCase(), month: m, quantity: q });
  });
  if (errors.length) back(ret, `Nothing imported. ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const key = { orgId_partNumber_month: { orgId: ctx.org.id, partNumber: r.partNumber, month: monthStart(r.month) } };
      if (r.quantity === 0) await tx.productDemand.deleteMany({ where: { orgId: ctx.org.id, partNumber: r.partNumber, month: monthStart(r.month) } });
      else await tx.productDemand.upsert({ where: key, create: { orgId: ctx.org.id, partNumber: r.partNumber, month: monthStart(r.month), quantity: r.quantity }, update: { quantity: r.quantity } });
    }
    await audit(ctx, { action: "demand_imported", entityType: "capacity", entityId: ctx.org.id, entityLabel: "Product demand", after: { rows: rows.length, parts: [...new Set(rows.map((r) => r.partNumber))].length } }, tx);
  }, { timeout: 120_000 });
  back(ret, `Demand saved: ${rows.length} row(s).`, "ok");
}

export async function saveBudgetRulesAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "planning", "edit");
  const t = await db.assetType.findFirst({ where: { id: str(fd, "assetTypeId"), orgId: ctx.org.id } });
  const ret = `/planning/budget?year=${str(fd, "year")}`;
  if (!t) back(ret, "Asset type not found.");
  const vals = Object.fromEntries(["pmCostPerService", "partsPerCavity", "refurbCost", "replacementCost"].map((k) => [k, Number(str(fd, k).replace(/,/g, "") || "0")]));
  if (Object.values(vals).some((v) => !Number.isFinite(v) || v < 0)) back(ret, "Costs must be zero or positive amounts.");
  const rules = normalizeBudgetRules(vals);
  await db.$transaction(async (tx) => {
    await tx.assetType.update({ where: { id: t.id }, data: { budgetRules: rules as unknown as Prisma.InputJsonValue } });
    await audit(ctx, { action: "budget_rules_updated", entityType: "asset_type", entityId: t.id, entityLabel: t.name, before: { rules: t.budgetRules }, after: { rules } }, tx);
  });
  back(ret, `Budget rules for ${t.name} saved.`, "ok");
}

/** Mass-apply: (re)generate rule-based budget lines for every asset of a type for a year. Manual lines are kept unless overwritten. */
export async function generateBudgetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "planning", "edit");
  const year = Number(str(fd, "year"));
  const ret = `/planning/budget?year=${year}`;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) back("/planning/budget", "Choose a year.");
  const t = await db.assetType.findFirst({ where: { id: str(fd, "assetTypeId"), orgId: ctx.org.id } });
  if (!t) back(ret, "Choose an asset type.");
  const rules = normalizeBudgetRules(t.budgetRules);
  if (!Object.values(rules).some((v) => v > 0)) back(ret, `Set the budget rules for ${t.name} first.`);
  const overwrite = str(fd, "overwrite") === "on";
  const fleet = (await fleetForecast(ctx)).filter((r) => r.asset.assetTypeId === t.id);
  const assets = await db.asset.findMany({ where: { AND: [assetScope(ctx), { assetTypeId: t.id, status: { notIn: ["retired", "scrapped"] } }] }, include: { plans: { where: { active: true } } } });
  const inYear = (d: Date | null) => !!d && d.getUTCFullYear() === year;
  let lines = 0;
  let kept = 0;
  await db.$transaction(async (tx) => {
    for (const a of assets) {
      const f = fleet.find((r) => r.asset.id === a.id);
      const b = budgetFromRules(rules, {
        plans: a.plans,
        shotsPerYear: f?.rate != null ? f.rate * 12 : null,
        cavities: a.designCavities,
        refurbsInYear: f ? f.forecast.refurbs.filter((x) => inYear(x.date)).length : 0,
        eolInYear: inYear(f?.forecast.eol?.date ?? null),
      });
      const existing = await tx.budgetItem.findMany({ where: { assetId: a.id, year } });
      for (const [category, amount] of Object.entries(b)) {
        if (category === "other") continue;
        const cur = existing.find((e) => e.category === category);
        if (cur?.source === "manual" && !overwrite) { kept++; continue; }
        if (!amount && !cur) continue;
        await tx.budgetItem.upsert({
          where: { assetId_year_category: { assetId: a.id, year, category } },
          create: { orgId: ctx.org.id, assetId: a.id, year, category, amount, source: "rule" },
          update: { amount, source: "rule", note: "" },
        });
        lines++;
      }
    }
    await audit(ctx, { action: "budget_generated", entityType: "budget", entityId: `${year}`, entityLabel: `${t.name} ${year}`, after: { assets: assets.length, lines, keptManual: kept, rules } }, tx);
  }, { timeout: 120_000 });
  back(ret, `Budget ${year} generated for ${assets.length} ${t.name.toLowerCase()} asset(s): ${lines} line(s)${kept ? `, ${kept} manual line(s) kept` : ""}.`, "ok");
}

export async function adjustBudgetAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "planning", "edit");
  const year = Number(str(fd, "year"));
  const ret = `/planning/budget?year=${year}`;
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: str(fd, "asset"), mode: "insensitive" } }] } });
  if (!a) back(ret, "Asset not found or not in your scope.");
  const category = str(fd, "category");
  if (!(category in BUDGET_CATEGORIES)) back(ret, "Choose a category.");
  const amount = Number(str(fd, "amount").replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) back(ret, "Amount must be zero or positive.");
  const reason = str(fd, "reason");
  if (reason.length < 3) back(ret, "Give a reason for the adjustment.");
  const before = await db.budgetItem.findUnique({ where: { assetId_year_category: { assetId: a.id, year, category } } });
  await db.$transaction(async (tx) => {
    await tx.budgetItem.upsert({
      where: { assetId_year_category: { assetId: a.id, year, category } },
      create: { orgId: ctx.org.id, assetId: a.id, year, category, amount, source: "manual", note: reason },
      update: { amount, source: "manual", note: reason },
    });
    await audit(ctx, { action: "budget_adjusted", entityType: "budget", entityId: `${year}`, entityLabel: `${a.number} ${year} ${category}`, before: { amount: before ? Number(before.amount) : null }, after: { amount }, reason }, tx);
  });
  back(ret, `${a.number} ${BUDGET_CATEGORIES[category as keyof typeof BUDGET_CATEGORIES].toLowerCase()} budget set.`, "ok");
}
