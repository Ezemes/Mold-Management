import "server-only";
import { db } from "./db";
import { assetScope, type Ctx } from "./auth";
import { transferScope } from "./transfers";
import { ASSET_STATUS } from "./assets";
import { fleetForecast } from "./planning";
import { actualByCategory, BUDGET_CATEGORIES, type BudgetCategory } from "./planning.pure";
import { woCost } from "./maintenance";
import { calculate, CALC_FIELDS, inputFromAsset, type Calc, type CalcKey } from "./calc.pure";
import { assessmentOutcome, ratingWord, type Answers, type ComponentResult } from "./inspection.pure";
import { durationHours, loadMetrics } from "./downtime";
import { dateToLocalInput } from "./format";

export type Cell = string | number | null;
export type Report = { title: string; description: string; columns: string[]; rows: Cell[][]; numeric?: number[]; footer?: Cell[] };

const DAY = 86_400_000;

export const REPORTS = {
  fleet_status: { title: "Fleet status", description: "Assets by site and status." },
  custody: { title: "Custody by partner", description: "Who holds the molds, how many are in transit, and their capital value." },
  life: { title: "Life consumed", description: "Distribution of molds by % of end-of-life shots used." },
  approaching: { title: "Refurbishment and end of life (90 days)", description: "Molds forecast to need refurbishment or reach end of life in the next 90 days." },
  maintenance_cost: { title: "Maintenance cost per mold", description: "Completed work in the last 12 months: cost, shots run and cost per 1,000 shots." },
  budget: { title: "Budget vs actual", description: "This year's budget against completed work-order spend, by category." },
  transit: { title: "Transfers and transit time", description: "Completed transfers in the last 12 months and average days in transit, by route." },
  reconciliation: { title: "Reconciliation exceptions", description: "Production reports whose parts ÷ cavities disagree with the shot counter beyond tolerance." },
  inspection_summary: { title: "Inspection summary", description: "One row per mold with the columns of the inspection template's Summary sheet." },
  calculated_fields: { title: "Calculated fields", description: "Lifecycle and capacity calculations for every mold, with the inputs each one still needs." },
  availability: { title: "MTBF and availability", description: "Each mold over the last 12 months: availability, MTBF, MTTR, failures and hours lost by category." },
  downtime_events: { title: "Downtime events", description: "Every downtime event in the last 12 months, with reason, category, duration and work order." },
  data_quality: { title: "Data quality", description: "Mold passports missing fields needed for life tracking, planning and press compatibility." },
} as const;
export type ReportKey = keyof typeof REPORTS;

const MOLD_FIELDS: [string, string][] = [
  ["designCavities", "Cavities"], ["designCycleTimeS", "Cycle time"], ["clampTonnageT", "Tonnage"], ["shotWeightG", "Shot weight"],
  ["widthMm", "Width"], ["heightMm", "Height"], ["stackHeightMm", "Mold height"], ["warrantyShots", "Warranty shots"],
  ["endOfLifeShots", "End-of-life shots"], ["shotsBetweenRefurbs", "Shots between refurbs"],
];

export async function buildReport(ctx: Ctx, key: ReportKey, now = new Date()): Promise<Report> {
  const meta = REPORTS[key];
  const scope = assetScope(ctx);
  switch (key) {
    case "fleet_status": {
      const assets = await db.asset.findMany({ where: { AND: [scope, { parentId: null }] }, select: { status: true, site: { select: { name: true } } } });
      const statuses = Object.keys(ASSET_STATUS);
      const sites = [...new Set(assets.map((a) => a.site.name))].sort();
      const rows = sites.map((s) => [s, ...statuses.map((st) => assets.filter((a) => a.site.name === s && a.status === st).length), assets.filter((a) => a.site.name === s).length]);
      return { ...meta, columns: ["Site", ...Object.values(ASSET_STATUS), "Total"], rows, numeric: statuses.map((_, i) => i + 1).concat(statuses.length + 1), footer: ["Total", ...statuses.map((st) => assets.filter((a) => a.status === st).length), assets.length] };
    }
    case "custody": {
      const molds = await db.asset.findMany({ where: { AND: [scope, { parentId: null, status: { notIn: ["retired", "scrapped"] } }] }, select: { status: true, capitalValue: true, custodianPartner: { select: { name: true } } } });
      const holders = [...new Set(molds.map((m) => m.custodianPartner?.name ?? ctx.org.name))].sort();
      const rows = holders.map((h) => {
        const mine = molds.filter((m) => (m.custodianPartner?.name ?? ctx.org.name) === h);
        return [h, mine.length, mine.filter((m) => m.status === "in_transfer").length, Math.round(mine.reduce((t, m) => t + Number(m.capitalValue ?? 0), 0))];
      });
      return { ...meta, columns: ["Held by", "Assets", "In transit", `Capital value (${ctx.org.currency})`], rows, numeric: [1, 2, 3] };
    }
    case "life": {
      const fleet = await fleetForecast(ctx, now);
      const buckets: [string, (p: number) => boolean][] = [["0–25%", (p) => p < 25], ["25–50%", (p) => p >= 25 && p < 50], ["50–80%", (p) => p >= 50 && p < 80], ["80–95%", (p) => p >= 80 && p < 95], ["95% and over", (p) => p >= 95]];
      const withEol = fleet.filter((r) => r.forecast.eol);
      const rows: Cell[][] = buckets.map(([l, f]) => { const m = withEol.filter((r) => f(r.forecast.eol!.pct)); return [l, m.length, m.map((r) => r.asset.number).slice(0, 12).join(", ")]; });
      rows.push(["No end-of-life shots set", fleet.length - withEol.length, fleet.filter((r) => !r.forecast.eol).map((r) => r.asset.number).slice(0, 12).join(", ")]);
      return { ...meta, columns: ["Life used", "Molds", "Examples"], rows, numeric: [1] };
    }
    case "approaching": {
      const fleet = await fleetForecast(ctx, now);
      const limit = new Date(now.getTime() + 90 * DAY);
      const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
      const rows = fleet
        .flatMap((r) => [
          ...(r.forecast.refurbs[0]?.date && r.forecast.refurbs[0].date <= limit ? [[r.asset.number, r.asset.name, r.asset.custodianPartner?.name ?? ctx.org.name, "Refurbishment", r.forecast.refurbs[0].shots, d(r.forecast.refurbs[0].date), Math.round(r.rate ?? 0)] as Cell[]] : []),
          ...(r.forecast.eol?.date && r.forecast.eol.date <= limit ? [[r.asset.number, r.asset.name, r.asset.custodianPartner?.name ?? ctx.org.name, "End of life", r.forecast.eol.shots, d(r.forecast.eol.date), Math.round(r.rate ?? 0)] as Cell[]] : []),
        ])
        .sort((a, b) => String(a[5]).localeCompare(String(b[5])));
      return { ...meta, columns: ["Mold", "Name", "Held by", "Event", "At shots", "Forecast date", "Shots / month"], rows, numeric: [4, 6] };
    }
    case "maintenance_cost": {
      const since = new Date(now.getTime() - 365 * DAY);
      const wos = await db.workOrder.findMany({ where: { orgId: ctx.org.id, status: "completed", completedAt: { gte: since }, asset: scope }, include: { labor: true, parts: true, asset: { select: { id: true, number: true, name: true, meters: { where: { kind: "shots" }, select: { id: true } } } } } });
      const meterIds = [...new Set(wos.flatMap((w) => w.asset.meters.map((m) => m.id)))];
      const readings = await db.meterReading.findMany({ where: { meterId: { in: meterIds }, readAt: { gte: since } }, select: { meterId: true, delta: true } });
      const byAsset = new Map<string, { number: string; name: string; n: number; corrective: number; cost: number; shots: number }>();
      for (const w of wos) {
        const r = byAsset.get(w.assetId) ?? { number: w.asset.number, name: w.asset.name, n: 0, corrective: 0, cost: 0, shots: readings.filter((x) => w.asset.meters.some((m) => m.id === x.meterId)).reduce((t, x) => t + Math.max(0, x.delta), 0) };
        r.n++; if (w.type === "corrective") r.corrective++; r.cost += woCost(w).total;
        byAsset.set(w.assetId, r);
      }
      const rows = [...byAsset.values()].sort((a, b) => b.cost - a.cost).map((r) => [r.number, r.name, r.n, r.corrective, Math.round(r.cost), r.shots, r.shots ? Math.round((r.cost / r.shots) * 1000 * 100) / 100 : null]);
      return { ...meta, columns: ["Mold", "Name", "Work orders", "Corrective", `Cost (${ctx.org.currency})`, "Shots (12 mo)", `Cost per 1,000 shots`], rows, numeric: [2, 3, 4, 5, 6] };
    }
    case "budget": {
      const year = now.getUTCFullYear();
      const [items, wos] = await Promise.all([
        db.budgetItem.findMany({ where: { orgId: ctx.org.id, year, asset: scope } }),
        db.workOrder.findMany({ where: { orgId: ctx.org.id, status: "completed", completedAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }, asset: scope }, include: { labor: true, parts: true } }),
      ]);
      const actual = actualByCategory(wos.map((w) => { const c = woCost(w); return { type: w.type, labor: c.labor, parts: c.parts, external: c.external }; }));
      const cats = Object.keys(BUDGET_CATEGORIES) as BudgetCategory[];
      const rows = cats.map((c) => { const b = items.filter((i) => i.category === c).reduce((t, i) => t + Number(i.amount), 0); return [BUDGET_CATEGORIES[c], Math.round(b), Math.round(actual[c]), Math.round(b - actual[c]), b ? Math.round((actual[c] / b) * 100) : null]; });
      const tb = rows.reduce((t, r) => t + (r[1] as number), 0);
      const ta = rows.reduce((t, r) => t + (r[2] as number), 0);
      return { ...meta, title: `${meta.title} ${year}`, columns: ["Category", "Budget", "Actual", "Remaining", "% used"], rows, numeric: [1, 2, 3, 4], footer: ["Total", tb, ta, tb - ta, tb ? Math.round((ta / tb) * 100) : null] };
    }
    case "transit": {
      const since = new Date(now.getTime() - 365 * DAY);
      const ts = await db.transfer.findMany({ where: { AND: [transferScope(ctx), { OR: [{ status: "in_transit" }, { receivedAt: { gte: since } }] }] }, include: { fromSite: true, toSite: true, _count: { select: { items: true } } } });
      const routes = new Map<string, { n: number; molds: number; days: number[]; open: number }>();
      for (const t of ts) {
        const k = `${t.fromSite.name} → ${t.toSite.name}`;
        const r = routes.get(k) ?? { n: 0, molds: 0, days: [], open: 0 };
        if (t.status === "in_transit") r.open++;
        else { r.n++; r.molds += t._count.items; if (t.shippedAt && t.receivedAt) r.days.push((t.receivedAt.getTime() - t.shippedAt.getTime()) / DAY); }
        routes.set(k, r);
      }
      const rows = [...routes.entries()].map(([k, r]) => [k, r.n, r.molds, r.days.length ? Math.round((r.days.reduce((a, b) => a + b, 0) / r.days.length) * 10) / 10 : null, r.open]);
      return { ...meta, columns: ["Route", "Transfers received", "Molds moved", "Average days in transit", "In transit now"], rows, numeric: [1, 2, 3, 4] };
    }
    case "reconciliation": {
      const xs = await db.reconciliationException.findMany({ where: { orgId: ctx.org.id, asset: scope }, include: { asset: { select: { number: true } }, report: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 5000 });
      const d = (x: Date) => x.toISOString().slice(0, 10);
      const rows = xs.map((x) => [x.asset.number, d(x.report.periodStart), d(new Date(x.report.periodEnd.getTime() - 1)), x.report.partNumber || "", x.report.parts, x.expectedShots, x.recordedShots, x.gap, x.gapPct, x.status, x.resolution]);
      return { ...meta, description: `${meta.description} ${xs.filter((x) => x.status === "open").length} open.`, columns: ["Mold", "From", "To", "Part", "Parts", "Expected shots", "Counted shots", "Gap", "Gap %", "Status", "Resolution"], rows, numeric: [4, 5, 6, 7, 8] };
    }
    case "inspection_summary": {
      const molds = await db.asset.findMany({
        where: { AND: [scope, { assetType: { kind: "mold" }, parentId: null }] },
        include: { site: { include: { division: true, partner: true } }, meters: true, cavities: { select: { status: true } }, products: true, ownerPartner: true, toolmakerPartner: true, assetType: true, _count: { select: { workOrders: { where: { status: { in: ["open", "in_progress", "on_hold"] } } } } } },
        orderBy: { number: "asc" },
      });
      const latest = await db.conditionEvaluation.findMany({ where: { assetId: { in: molds.map((m) => m.id) } }, orderBy: { evaluatedAt: "desc" }, distinct: ["assetId"] });
      const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
      const rows = molds.map((m) => {
        const c = calculate(inputFromAsset(m, ctx.org), now).lifecycle;
        const ev = latest.find((e) => e.assetId === m.id);
        const ans = (ev?.answers ?? {}) as Partial<Answers>;
        const out = ev ? assessmentOutcome(ev.scores as unknown as ComponentResult[], { qualityIssues: ans.qualityIssues ?? null, operationalIssues: ans.operationalIssues ?? null, spareParts: ans.spareParts ?? null, supplyRisk: ans.supplyRisk ?? null }, ev.score, m.assetType.evalThreshold) : null;
        const meter = m.meters.find((x) => x.kind === "shots");
        return [
          m.id, m.site.division?.name ?? "", m.site.name, m.process, m.status, m.toolNumber, m.number, m.name, m.componentType, d(m.nextEvaluationDate),
          m.designCavities, m.designCycleTimeS, m.conditionScore != null ? `${m.conditionScore.toFixed(2)} (${ratingWord(Math.round(m.conditionScore))})` : "", m.annualVolume, meter?.lifetimeTotal ?? null,
          d(m.lastRunDate), d(m.lastRefurbDate), d(c.nextRefurbishment.value), m.refurbsDone, c.refurbsRemaining.value, m._count.workOrders, out ? (out.workOrderRequired ? "Yes" : "No") : "",
          d(m.buildDate), m.toolmakerPartner?.name ?? "", m.products.map((p) => p.partNumber).join("; "), m.productDrawing, m.brandName, m.platform, m.ownerPartner?.name ?? ctx.org.name,
        ];
      });
      return { ...meta, columns: ["ID", "Division", "Location", "Department", "Status", "Supplier Tool #", "Number", "Description", "Component Type", "Next Evaluation Date", "# Cavities", "Cycle Time", "Condition Rating", "Annual Volume", "Cycle Count", "Last Run Date", "Last Refurbished", "Next Refurbishment", "Refurbs Completed", "Refurbs Remaining", "No. Open Work Orders", "New W/O Req Yes or No", "Date Built", "Built By", "Part Number", "Product Drawing #", "Brand Name", "Platform", "Ownership"], rows, numeric: [10, 11, 13, 14, 18, 19, 20] };
    }
    case "calculated_fields": {
      const molds = await db.asset.findMany({ where: { AND: [scope, { assetType: { kind: "mold" }, parentId: null, status: { notIn: ["retired", "scrapped"] } }] }, include: { site: true, meters: true, cavities: { select: { status: true } } }, orderBy: { number: "asc" } });
      const keys = Object.keys(CALC_FIELDS) as CalcKey[];
      const fmt = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? Math.round(v * 100) / 100 : (v as Cell) ?? null);
      const rows = molds.map((m) => {
        const r = calculate(inputFromAsset(m, ctx.org), now);
        const all = { ...r.lifecycle, ...r.capacity } as Record<CalcKey, Calc<unknown>>;
        const missing = [...new Set(keys.flatMap((k) => all[k].missing ?? []))];
        return [m.number, m.name, m.process, m.site.name, ...keys.map((k) => fmt(all[k].value)), missing.join(", ")];
      });
      return { ...meta, description: `${meta.description} Costs in ${ctx.org.cavityCostCurrency}.`, columns: ["Mold", "Name", "Process", "Site", ...keys.map((k) => CALC_FIELDS[k].label), "Missing inputs"], rows, numeric: keys.map((_, i) => i + 4).filter((i) => !["date", "text"].includes(CALC_FIELDS[keys[i - 4]].kind)) };
    }
    case "availability": {
      const m = await loadMetrics(ctx, new Date(now.getTime() - 365 * DAY), now, {}, now);
      const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
      const rows = m.assets.map((a) => {
        const s = m.perAsset.get(a.id)!;
        return [a.number, a.name, a.site.name, r1(s.availabilityPct), r1(s.mtbfHours), r1(s.mttrHours), s.failures, r1(s.failureHours), r1(s.plannedHours), r1(s.externalHours), s.openNow ? "Yes" : "No"];
      });
      const t = m.total;
      return { ...meta, columns: ["Mold", "Name", "Site", "Availability %", "MTBF (h)", "MTTR (h)", "Failures", "Failure (h)", "Planned (h)", "External (h)", "Down now"], rows, numeric: [3, 4, 5, 6, 7, 8, 9], footer: ["Fleet", "", "", r1(t.availabilityPct), r1(t.mtbfHours), r1(t.mttrHours), t.failures, r1(t.failureHours), r1(t.plannedHours), r1(t.externalHours), t.openNow] };
    }
    case "downtime_events": {
      const since = new Date(now.getTime() - 365 * DAY);
      const evs = await db.downtimeEvent.findMany({
        where: { orgId: ctx.org.id, asset: scope, OR: [{ startedAt: { gte: since } }, { endedAt: null }] },
        include: { asset: { select: { number: true, site: { select: { name: true } } } }, press: { select: { number: true } }, code: true, workOrder: { select: { number: true } } },
        orderBy: { startedAt: "desc" },
        take: 20_000,
      });
      const local = (d: Date | null) => (d ? dateToLocalInput(d, ctx.org.timezone).replace("T", " ") : "");
      const rows = evs.map((e) => [e.number, e.asset.number, e.asset.site.name, e.press?.number ?? "", e.code.code, e.code.name, e.category, local(e.startedAt), local(e.endedAt), Math.round(durationHours(e, now) * 10) / 10, e.workOrder?.number ?? "", e.description]);
      return { ...meta, description: `${meta.description} Times are ${ctx.org.timezone}.`, columns: ["Event", "Mold", "Site", "Press", "Code", "Reason", "Category", "Started", "Ended", "Hours", "Work order", "Description"], rows, numeric: [9] };
    }
    case "data_quality": {
      const molds = await db.asset.findMany({ where: { AND: [scope, { assetType: { kind: "mold" }, parentId: null, status: { notIn: ["retired", "scrapped"] } }] }, include: { meters: true, products: { select: { id: true } } }, orderBy: { number: "asc" } });
      let filled = 0;
      const checks = MOLD_FIELDS.length + 2;
      const rows: Cell[][] = [];
      for (const m of molds) {
        const missing = MOLD_FIELDS.filter(([k]) => (m as unknown as Record<string, unknown>)[k] == null).map(([, l]) => l);
        if (!m.meters.some((x) => x.kind === "shots" && x.lastReadingAt)) missing.push("Shot reading");
        if (!m.products.length) missing.push("Products");
        filled += checks - missing.length;
        if (missing.length) rows.push([m.number, m.name, Math.round(((checks - missing.length) / checks) * 100), missing.join(", ")]);
      }
      const score = molds.length ? Math.round((filled / (molds.length * checks)) * 100) : null;
      return { ...meta, description: `${meta.description} Fleet score: ${score ?? "—"}% complete across ${molds.length} molds.`, columns: ["Mold", "Name", "Complete %", "Missing"], rows: rows.sort((a, b) => (a[2] as number) - (b[2] as number)), numeric: [2] };
    }
  }
}
