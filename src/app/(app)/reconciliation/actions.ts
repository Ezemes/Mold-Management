"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, assetScope, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/forms";
import { localInputToDate } from "@/lib/format";
import { ingestProduction } from "@/lib/ingest";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

/** "YYYY-MM-DD", "DD-MM-YYYY" (optionally with " HH:mm") in the org's time zone, or a full ISO date-time. A date-only end is inclusive. */
function csvDate(raw: string, tz: string, isEnd: boolean): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!m) { const x = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T](\d{2}):(\d{2}))?$/); if (x) m = [x[0], x[3], x[2], x[1], x[4], x[5]] as RegExpMatchArray; }
  if (!m) return null;
  const d = localInputToDate(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}`, tz);
  if (isNaN(d.getTime())) return null;
  return (isEnd && !m[4] ? new Date(d.getTime() + 86_400_000) : d).toISOString();
}

export async function importProductionAction(fd: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "readings", "create");
  const ret = "/reconciliation?view=reports";
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : str(fd, "rows");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /asset/i.test(lines[0])) lines.shift();
  if (!lines.length) back(ret, "Paste rows: asset, period_start, period_end, parts, part_number, reference.");
  if (lines.length > 5000) back(ret, "At most 5,000 rows per import.");
  const errors: string[] = [];
  const items = lines.map((line, i) => {
    const [asset, start, end, parts, partNumber, reference] = line.split(/[,;\t]/).map((x) => x?.trim().replace(/^"|"$/g, "") ?? "");
    const ps = csvDate(start ?? "", ctx.org.timezone, false);
    const pe = csvDate(end ?? "", ctx.org.timezone, true);
    if (!ps || !pe) errors.push(`Row ${i + 1}: dates should be YYYY-MM-DD or DD-MM-YYYY`);
    return { asset, period_start: ps, period_end: pe, parts: Number((parts ?? "").replace(/,/g, "")), part_number: partNumber, reference };
  });
  if (errors.length) back(ret, `Nothing imported. ${errors.slice(0, 5).join("; ")}`);
  // Only assets the user can see: restrict to their sites when scoped.
  const visible = await db.asset.findMany({ where: { AND: [assetScope(ctx), { number: { in: items.map((i) => i.asset), mode: "insensitive" } }] }, select: { number: true } });
  const hidden = items.filter((i) => !visible.some((v) => v.number.toLowerCase() === i.asset.toLowerCase()));
  if (hidden.length) back(ret, `Nothing imported. Not found or not in your scope: ${[...new Set(hidden.map((h) => h.asset))].slice(0, 8).join(", ")}`);
  const results = await ingestProduction({ orgId: ctx.org.id, userId: ctx.user.id, label: "CSV import" }, { siteIds: [] }, items, "import");
  const failed = results.filter((r) => r.status === "error");
  if (failed.length) back(ret, `${results.length - failed.length} row(s) saved; ${failed.length} rejected: ${failed.slice(0, 5).map((f) => `row ${f.index + 1} ${f.message}`).join("; ")}`);
  const st = (s: string) => results.filter((r) => r.reconciliation === s).length;
  back(ret, `${results.length} report(s) saved: ${st("matched")} matched, ${st("exception")} exception(s), ${st("pending")} waiting for readings, ${st("unverifiable")} unverifiable.`, "ok");
}

async function decide(fd: FormData, status: "accepted" | "resolved") {
  const ctx = await requireOrg();
  assertCan(ctx, "readings", "edit");
  const x = await db.reconciliationException.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id, status: "open", asset: assetScope(ctx) }, include: { asset: true } });
  if (!x) back("/reconciliation", "Exception not found or already closed.");
  const note = str(fd, "resolution");
  if (note.length < 5) back("/reconciliation", status === "accepted" ? "Explain the gap (e.g. trial shots, scrap not reported) before accepting." : "Say what was corrected (e.g. reading fixed, production quantity re-sent).");
  await db.$transaction(async (tx) => {
    await tx.reconciliationException.update({ where: { id: x.id }, data: { status, resolution: note, resolvedById: ctx.user.id, resolvedAt: new Date() } });
    await audit(ctx, { action: `reconciliation_${status}`, entityType: "asset", entityId: x.assetId, entityLabel: `${x.asset.number} ${x.asset.name}`, after: { expected: x.expectedShots, recorded: x.recordedShots, gap: x.gap }, reason: note }, tx);
  });
  back("/reconciliation", status === "accepted" ? "Gap accepted with your explanation." : "Marked as resolved.", "ok");
}

export async function acceptExceptionAction(fd: FormData) {
  await decide(fd, "accepted");
}
export async function resolveExceptionAction(fd: FormData) {
  await decide(fd, "resolved");
}
