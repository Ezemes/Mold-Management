import type { Calc } from "@/lib/calc.pure";
import { CALC_FIELDS, type CalcKey } from "@/lib/calc.pure";
import { fmtDate, fmtNum } from "@/lib/format";
import { Badge } from "./ui";

type Org = { numberFormat: string; timezone: string };
const PRIORITY = { Critical: "red", Consider: "amber", "Not necessary": "green" } as const;

/** One calculated value, or what it needs. Money is shown in the cost table's currency. */
export function CalcValue({ k, c, org, currency }: { k: CalcKey; c: Calc<unknown>; org: Org; currency: string }) {
  const kind = CALC_FIELDS[k].kind;
  if (c.value == null) {
    return c.missing?.length ? <span className="text-xs text-amber-700">Needs {c.missing.join(", ")}</span> : <span className="text-xs text-ink-500">{c.note ?? "—"}</span>;
  }
  const v = c.value;
  if (kind === "date") return <>{fmtDate(v as Date, org.timezone)}</>;
  if (kind === "text") return <Badge color={PRIORITY[v as keyof typeof PRIORITY] ?? "gray"}>{String(v)}</Badge>;
  if (kind === "pct") return <>{fmtNum(v as number, org, 1)}%</>;
  if (kind === "money") return <>{(v as number).toLocaleString(org.numberFormat === "indian" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 })}</>;
  if (kind === "days") return <>{fmtNum(v as number, org, 1)} days</>;
  return <>{fmtNum(Math.round(v as number), org)}{kind === "shots" ? " shots" : kind === "parts" ? " parts" : ""}</>;
}
