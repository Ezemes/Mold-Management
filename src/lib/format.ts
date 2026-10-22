export type OrgFormat = { timezone: string; currency: string; numberFormat: string; unitSystem: string };

/** Numbers grouped the Indian way (12,34,567) or internationally (1,234,567). */
export function fmtNum(n: number | null | undefined, org: Pick<OrgFormat, "numberFormat">, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(org.numberFormat === "indian" ? "en-IN" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtMoney(n: number | null | undefined, org: Pick<OrgFormat, "numberFormat" | "currency">): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(org.numberFormat === "indian" ? "en-IN" : "en-US", { style: "currency", currency: org.currency, maximumFractionDigits: 0 });
}

export function fmtDate(d: Date | string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
}

export function fmtDateTime(d: Date | string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz });
}

/** Stored values are metric; convert for display when the org prefers imperial. */
export const UNITS = {
  mm: { metric: ["mm", 1], imperial: ["in", 1 / 25.4] },
  kg: { metric: ["kg", 1], imperial: ["lb", 2.20462] },
  g: { metric: ["g", 1], imperial: ["oz", 0.035274] },
  t: { metric: ["t", 1], imperial: ["US ton", 1.10231] },
} as const;

export function fmtUnit(v: number | null | undefined, unit: keyof typeof UNITS, org: Pick<OrgFormat, "unitSystem" | "numberFormat">) {
  if (v == null) return "—";
  const [label, factor] = UNITS[unit][org.unitSystem === "imperial" ? "imperial" : "metric"];
  return `${fmtNum(v * factor, org, 2)} ${label}`;
}

/** Offset in minutes of a time zone at a given instant (e.g. Asia/Kolkata → 330). */
function tzOffsetMinutes(tz: string, at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Interpret a <input type="datetime-local"> value ("2026-10-22T14:30") as wall-clock time in `tz`. */
export function localInputToDate(value: string, tz: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = tzOffsetMinutes(tz, new Date(guess));
  return new Date(guess - off * 60_000);
}

/** Format a Date for <input type="datetime-local"> in `tz`. */
export function dateToLocalInput(d: Date, tz: string) {
  const off = tzOffsetMinutes(tz, d);
  return new Date(d.getTime() + off * 60_000).toISOString().slice(0, 16);
}
