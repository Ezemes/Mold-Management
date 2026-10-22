import type { FieldDef } from "@prisma/client";
import { STD_FIELDS, type StdField } from "./assets";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseNumber(raw: string, label: string, integer: boolean): Parsed<number | null> {
  const s = raw.replace(/,/g, "").trim(); // accept 1,00,000 and 100,000
  if (!s) return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: `${label}: "${raw}" is not a number` };
  if (integer && !Number.isInteger(n)) return { ok: false, error: `${label}: must be a whole number` };
  if (n < 0) return { ok: false, error: `${label}: cannot be negative` };
  return { ok: true, value: n };
}

/** Accepts YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY (common in India). */
export function parseDate(raw: string, label: string): Parsed<Date | null> {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else return { ok: false, error: `${label}: use YYYY-MM-DD or DD-MM-YYYY` };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { ok: false, error: `${label}: "${raw}" is not a real date` };
  return { ok: true, value: dt };
}

export function parseStd(f: StdField, raw: string): Parsed<string | number | Date | null> {
  switch (f.type) {
    case "int":
      return parseNumber(raw, f.label, true);
    case "float":
    case "money":
      return parseNumber(raw, f.label, false);
    case "date":
      return parseDate(raw, f.label);
    default: {
      const v = raw.trim();
      if (!v || !f.options) return { ok: true, value: v };
      const hit = f.options.find((o) => o.toLowerCase() === v.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `${f.label}: "${v}" is not one of ${f.options.join(", ")}` };
    }
  }
}

export function parseCustom(def: FieldDef, raw: string): Parsed<string | number | boolean | null> {
  const s = raw.trim();
  if (def.type === "formula") return { ok: true, value: null };
  if (!s) return def.required ? { ok: false, error: `${def.label} is required` } : { ok: true, value: null };
  switch (def.type) {
    case "number":
      return parseNumber(s, def.label, false) as Parsed<number | null>;
    case "date": {
      const d = parseDate(s, def.label);
      return d.ok ? { ok: true, value: d.value ? d.value.toISOString().slice(0, 10) : null } : d;
    }
    case "boolean":
      if (/^(1|true|yes|y|on)$/i.test(s)) return { ok: true, value: true };
      if (/^(0|false|no|n|off)$/i.test(s)) return { ok: true, value: false };
      return { ok: false, error: `${def.label}: use yes or no` };
    case "picklist": {
      const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `${def.label}: "${s}" is not one of ${def.options.join(", ")}` };
    }
    default:
      return { ok: true, value: s.slice(0, 2000) };
  }
}

/** Read standard + custom field values from a source (form or CSV row). Missing keys are left untouched. */
export function readFieldValues(
  get: (name: string) => string | undefined,
  kind: string,
  defs: FieldDef[],
  existingCustom: Record<string, unknown> = {},
) {
  const errors: string[] = [];
  const std: Record<string, unknown> = {};
  for (const f of STD_FIELDS.filter((x) => x.kinds.includes(kind as never))) {
    const raw = get(f.var);
    if (raw === undefined) continue;
    const r = parseStd(f, raw);
    if (r.ok) std[f.key] = f.type === "text" ? (r.value ?? "") : (r.value ?? f.emptyValue ?? null);
    else errors.push(r.error);
  }
  const custom: Record<string, unknown> = { ...existingCustom };
  for (const d of defs.filter((x) => !x.archived && x.type !== "formula")) {
    const raw = get(`cf_${d.key}`);
    if (raw === undefined) {
      if (d.required && (custom[d.key] === undefined || custom[d.key] === null || custom[d.key] === "")) errors.push(`${d.label} is required`);
      continue;
    }
    const r = parseCustom(d, raw);
    if (r.ok) {
      if (r.value === null) delete custom[d.key];
      else custom[d.key] = r.value;
    } else errors.push(r.error);
  }
  return { std, custom, errors };
}
