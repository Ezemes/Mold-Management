import Papa from "papaparse";
import type { FieldDef } from "@prisma/client";
import { readFieldValues } from "./asset-values";
import { computeReading, type ReadingError } from "./meters.pure";
import { localInputToDate } from "./format";
import { validateDowntime } from "./downtime.pure";

export const MAX_IMPORT_ROWS = 10_000;

export type RowError = { row: number; message: string };

export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[]; error?: string } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  const fatal = res.errors.find((e) => e.type === "Delimiter" || e.type === "Quotes");
  if (fatal) return { header: [], rows: [], error: `CSV could not be read: ${fatal.message} (row ${(fatal.row ?? 0) + 2})` };
  if (res.data.length > MAX_IMPORT_ROWS) return { header: [], rows: [], error: `Too many rows (${res.data.length}). The limit is ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} per file.` };
  return { header: res.meta.fields ?? [], rows: res.data };
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export type AssetLookups = {
  types: { id: string; key: string; name: string; kind: string; archived: boolean; fields: FieldDef[] }[];
  /** Sites the importing user may use (already scope-filtered). Matched by name or code, case-insensitive. */
  sites: { id: string; name: string; code: string; partnerId: string | null; active: boolean }[];
  partners: { id: string; name: string }[];
  existing: { id: string; number: string; assetTypeId: string; custodianPartnerId: string | null; customValues: unknown }[];
};

export type AssetPlan =
  | { op: "create"; row: number; number: string; assetTypeId: string; name: string; siteId: string; custodianPartnerId: string | null; ownerPartnerId: string | null; locationDetail: string; program: string; std: Record<string, unknown>; custom: Record<string, unknown> }
  | { op: "update"; row: number; id: string; number: string; name?: string; siteId?: string; ownerPartnerId?: string | null; locationDetail?: string; program?: string; std: Record<string, unknown>; custom: Record<string, unknown> };

const norm = (s: string) => s.trim().toLowerCase();

export function planAssetImport(rows: Record<string, string>[], lk: AssetLookups) {
  const errors: RowError[] = [];
  const plans: AssetPlan[] = [];
  const seen = new Set<string>();
  const byNumber = new Map(lk.existing.map((a) => [norm(a.number), a]));
  const findSite = (v: string) => lk.sites.find((s) => norm(s.name) === norm(v) || (s.code && norm(s.code) === norm(v)));
  const findPartner = (v: string) => lk.partners.find((p) => norm(p.name) === norm(v));

  rows.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const fail = (m: string) => errors.push({ row, message: m });
    const number = (r.number ?? "").trim();
    if (!number) return fail("number is required");
    if (seen.has(norm(number))) return fail(`number ${number} appears more than once in this file`);
    seen.add(norm(number));
    const existing = byNumber.get(norm(number));
    const has = (k: string) => k in r && r[k] !== undefined;

    let type = existing ? lk.types.find((t) => t.id === existing.assetTypeId) : undefined;
    if (!existing) {
      if (!r.type) return fail("type is required for new assets (asset type key, e.g. mold)");
      type = lk.types.find((t) => norm(t.key) === norm(r.type) || norm(t.name) === norm(r.type));
      if (!type) return fail(`unknown type "${r.type}". Use one of: ${lk.types.map((t) => t.key).join(", ")}`);
      if (type.archived) return fail(`type ${type.name} is archived`);
    } else if (has("type") && r.type && type && norm(r.type) !== norm(type.key) && norm(r.type) !== norm(type.name)) {
      return fail("type cannot be changed by import");
    }
    if (!type) return fail("asset type not found");

    let site: AssetLookups["sites"][number] | undefined;
    if (has("site") && r.site) {
      site = findSite(r.site);
      if (!site) return fail(`site "${r.site}" not found or not in your scope`);
      if (!site.active) return fail(`site "${site.name}" is inactive`);
      if (existing && site.partnerId !== existing.custodianPartnerId) return fail(`site "${site.name}" belongs to a different custodian; moving between companies needs a transfer`);
    } else if (!existing) return fail("site is required for new assets");

    let owner: string | null | undefined;
    if (has("owner")) {
      if (!r.owner) owner = null;
      else {
        const p = findPartner(r.owner);
        if (!p) return fail(`owner "${r.owner}" is not a partner`);
        owner = p.id;
      }
    }

    const v = readFieldValues((k) => (has(k) ? r[k] : undefined), type.kind, type.fields, existing ? ((existing.customValues ?? {}) as Record<string, unknown>) : {});
    if (v.errors.length) return v.errors.forEach(fail);

    if (existing) {
      plans.push({ op: "update", row, id: existing.id, number: existing.number, ...(has("name") && r.name ? { name: r.name } : {}), ...(site ? { siteId: site.id } : {}), ...(owner !== undefined ? { ownerPartnerId: owner } : {}), ...(has("location") ? { locationDetail: r.location } : {}), ...(has("program") ? { program: r.program } : {}), std: v.std, custom: v.custom });
    } else {
      if (!r.name) return fail("name is required for new assets");
      plans.push({ op: "create", row, number, assetTypeId: type.id, name: r.name, siteId: site!.id, custodianPartnerId: site!.partnerId, ownerPartnerId: owner ?? null, locationDetail: r.location ?? "", program: r.program ?? "", std: v.std, custom: v.custom });
    }
  });
  return { plans, errors };
}

// ─── Readings ───────────────────────────────────────────────────────────────

export type MeterState = { meterId: string; assetId: string; number: string; offset: number; lastRawValue: number | null; lastReadingAt: Date | null; lifetimeTotal: number; cycleTimeS: number | null };
export type ReadingPlan = { row: number; meterId: string; assetId: string; number: string; rawValue: number; readAt: Date; isReset: boolean; resetReason: string; note: string };

/** Parse "YYYY-MM-DD HH:MM", "DD-MM-YYYY HH:MM" (or date only = 12:00) in the org's time zone. */
export function parseReadAt(v: string, tz: string): Date | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return localInputToDate(`${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}`, tz);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return localInputToDate(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}`, tz);
  return null;
}

/** Validate readings in time order per meter, simulating each one against the running meter state. */
export function planReadingImport(rows: Record<string, string>[], meters: MeterState[], tz: string, now = new Date()) {
  const errors: RowError[] = [];
  const byNumber = new Map(meters.map((m) => [norm(m.number), { ...m }]));
  const parsed: (ReadingPlan & { state: MeterState })[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const state = byNumber.get(norm(r.number ?? ""));
    if (!state) return errors.push({ row, message: `asset "${r.number}" not found, not in your scope, or has no shot counter` });
    const raw = Number((r.counter ?? "").replace(/,/g, ""));
    if (!r.counter || !Number.isInteger(raw) || raw < 0) return errors.push({ row, message: "counter must be a whole number" });
    const readAt = r.read_at ? parseReadAt(r.read_at, tz) : null;
    if (!readAt || Number.isNaN(readAt.getTime())) return errors.push({ row, message: "read_at must be YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM" });
    const isReset = /^(1|true|yes|y)$/i.test(r.reset ?? "");
    parsed.push({ row, meterId: state.meterId, assetId: state.assetId, number: state.number, rawValue: raw, readAt, isReset, resetReason: r.reset_reason ?? "", note: r.note ?? "", state });
  });
  parsed.sort((a, b) => a.readAt.getTime() - b.readAt.getTime() || a.row - b.row);
  const plans: ReadingPlan[] = [];
  for (const p of parsed) {
    try {
      const c = computeReading(p.state, { rawValue: p.rawValue, readAt: p.readAt, source: "import", isReset: p.isReset, resetReason: p.resetReason, cycleTimeS: p.state.cycleTimeS }, now);
      Object.assign(p.state, { offset: c.offset, lastRawValue: p.rawValue, lastReadingAt: p.readAt, lifetimeTotal: c.lifetime });
      const { state: _s, ...plan } = p;
      void _s;
      plans.push(plan);
    } catch (e) {
      errors.push({ row: p.row, message: `${p.number}: ${(e as ReadingError).message}` });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { plans, errors };
}

// ─── Downtime ───────────────────────────────────────────────────────────────

export type DowntimeLookups = {
  /** Molds in the importer's scope */
  assets: { id: string; number: string }[];
  presses: { id: string; number: string }[];
  codes: { id: string; code: string; category: string; active: boolean }[];
  workOrders: { id: string; number: string; assetId: string }[];
  existing: { assetId: string; number: string; startedAt: Date; endedAt: Date | null }[];
};
export type DowntimePlan = { row: number; assetId: string; assetNumber: string; codeId: string; category: string; startedAt: Date; endedAt: Date | null; pressId: string | null; workOrderId: string | null; description: string };

/** Validate downtime rows: known mold, code, times, and no overlap with recorded events or other rows. */
export function planDowntimeImport(rows: Record<string, string>[], lk: DowntimeLookups, tz: string, now = new Date()) {
  const errors: RowError[] = [];
  const plans: DowntimePlan[] = [];
  const byNumber = new Map(lk.assets.map((a) => [norm(a.number), a]));
  const taken = new Map<string, { number: string; startedAt: Date; endedAt: Date | null }[]>();
  for (const e of lk.existing) taken.set(e.assetId, [...(taken.get(e.assetId) ?? []), e]);
  rows.forEach((r, i) => {
    const row = i + 2;
    const fail = (m: string) => errors.push({ row, message: m });
    const a = byNumber.get(norm(r.number ?? ""));
    if (!a) return fail(`mold "${r.number ?? ""}" not found or not in your scope`);
    const code = lk.codes.find((c) => norm(c.code) === norm(r.code ?? ""));
    if (!code) return fail(`unknown code "${r.code ?? ""}". Use one of: ${lk.codes.filter((c) => c.active).map((c) => c.code).join(", ")}`);
    if (!code.active) return fail(`code ${code.code} is switched off`);
    const startedAt = r.started_at ? parseReadAt(r.started_at, tz) : null;
    if (!startedAt || Number.isNaN(startedAt.getTime())) return fail("started_at must be YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM");
    let endedAt: Date | null = null;
    if (r.ended_at) {
      endedAt = parseReadAt(r.ended_at, tz);
      if (!endedAt || Number.isNaN(endedAt.getTime())) return fail("ended_at must be YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM, or blank if the mold is still down");
    }
    let pressId: string | null = null;
    if (r.press) {
      const p = lk.presses.find((x) => norm(x.number) === norm(r.press));
      if (!p) return fail(`press "${r.press}" not found`);
      pressId = p.id;
    }
    let workOrderId: string | null = null;
    if (r.work_order) {
      const w = lk.workOrders.find((x) => norm(x.number) === norm(r.work_order));
      if (!w) return fail(`work order "${r.work_order}" not found`);
      if (w.assetId !== a.id) return fail(`work order ${w.number} is for a different asset`);
      workOrderId = w.id;
    }
    const others = taken.get(a.id) ?? [];
    const problem = validateDowntime({ startedAt, endedAt }, others, now);
    if (problem) return fail(`${a.number}: ${problem}`);
    taken.set(a.id, [...others, { number: `row ${row}`, startedAt, endedAt }]);
    plans.push({ row, assetId: a.id, assetNumber: a.number, codeId: code.id, category: code.category, startedAt, endedAt, pressId, workOrderId, description: (r.description ?? "").slice(0, 2000) });
  });
  return { plans, errors };
}
