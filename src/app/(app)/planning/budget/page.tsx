import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { actualByCategory, BUDGET_CATEGORIES, normalizeBudgetRules, type BudgetCategory } from "@/lib/planning";
import { woCost } from "@/lib/maintenance";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { Card, cx, Field, FlashFromParams, Input, PageHeader, Select, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { PLANNING_TABS } from "@/lib/tabs";
import { adjustBudgetAction, generateBudgetAction, saveBudgetRulesAction } from "../actions";

export const metadata = { title: "Budget" };

const CATS = Object.keys(BUDGET_CATEGORIES) as BudgetCategory[];

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["planning", "view"]);
  const thisYear = new Date().getUTCFullYear();
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const [items, wos, types, history] = await Promise.all([
    db.budgetItem.findMany({ where: { orgId: ctx.org.id, year, asset: assetScope(ctx) } }),
    db.workOrder.findMany({ where: { orgId: ctx.org.id, status: "completed", completedAt: { gte: start, lt: end }, asset: assetScope(ctx) }, include: { labor: true, parts: true } }),
    db.assetType.findMany({ where: { orgId: ctx.org.id, archived: false }, orderBy: { createdAt: "asc" } }),
    db.auditEvent.findMany({ where: { orgId: ctx.org.id, entityType: "budget", entityId: `${year}` }, orderBy: { createdAt: "desc" }, take: 30, include: { user: true } }),
  ]);
  const assetIds = [...new Set([...items.map((i) => i.assetId), ...wos.map((w) => w.assetId)])];
  const assets = await db.asset.findMany({ where: { id: { in: assetIds } }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true } });
  const rows = assets.map((a) => {
    const budget = Object.fromEntries(CATS.map((c) => [c, Number(items.find((i) => i.assetId === a.id && i.category === c)?.amount ?? 0)])) as Record<BudgetCategory, number>;
    const manual = new Set(items.filter((i) => i.assetId === a.id && i.source === "manual").map((i) => i.category));
    const actual = actualByCategory(wos.filter((w) => w.assetId === a.id).map((w) => { const c = woCost(w); return { type: w.type, labor: c.labor, parts: c.parts, external: c.external }; }));
    const b = CATS.reduce((t, c) => t + budget[c], 0);
    const x = CATS.reduce((t, c) => t + actual[c], 0);
    return { a, budget, actual, manual, b, x };
  });
  const totB = rows.reduce((t, r) => t + r.b, 0);
  const totA = rows.reduce((t, r) => t + r.x, 0);
  const money = (n: number) => fmtMoney(n, ctx.org);
  const canEdit = ctx.can("planning", "edit");
  return (
    <>
      <PageHeader title="Planning" subtitle="Budget per asset and year from asset-type rules, adjusted by hand where needed. Actuals come from completed work orders." />
      <SubTabs tabs={PLANNING_TABS} active="/planning/budget" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex gap-1">
        {[thisYear - 1, thisYear, thisYear + 1].map((y) => <Link key={y} href={`/planning/budget?year=${y}`} className={cx("rounded-md px-3 py-1.5 text-sm", y === year ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{y}</Link>)}
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label={`Budget ${year}`} value={money(totB)} />
        <Stat label="Actual to date" value={money(totA)} />
        <Stat label="Remaining" value={<span className={cx(totA > totB && "text-red-700")}>{money(totB - totA)}</span>} hint={totB ? `${Math.round((totA / totB) * 100)}% used` : undefined} />
      </div>
      <div className="mb-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-right text-xs">
          <thead className="border-b border-gray-200 bg-gray-50 text-ink-500">
            <tr><th className="px-3 py-2 text-left font-medium">Asset</th>{CATS.map((c) => <th key={c} className="px-3 py-2 font-medium">{BUDGET_CATEGORIES[c]}</th>)}<th className="px-3 py-2 font-medium">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && <tr><td colSpan={CATS.length + 2} className="px-3 py-8 text-center text-sm text-ink-500">No budget or spend for {year} yet. Set rules and generate below.</td></tr>}
            {rows.map((r) => (
              <tr key={r.a.id}>
                <td className="px-3 py-2 text-left"><Link href={`/assets/${r.a.id}`} className="font-medium hover:text-brand-700">{r.a.number}</Link><p className="text-ink-500">{r.a.name}</p></td>
                {CATS.map((c) => (
                  <td key={c} className="px-3 py-2 tabular-nums">
                    <span className="block">{money(r.budget[c])}{r.manual.has(c) && <span title="Adjusted by hand" className="text-brand-700"> ✎</span>}</span>
                    <span className={cx("block", r.actual[c] > r.budget[c] ? "text-red-700" : "text-ink-500")}>{money(r.actual[c])}</span>
                  </td>
                ))}
                <td className="px-3 py-2 font-medium tabular-nums"><span className="block">{money(r.b)}</span><span className={cx("block", r.x > r.b ? "text-red-700" : "text-ink-500")}>{money(r.x)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-gray-100 px-3 py-2 text-left text-xs text-ink-500">Each cell: budget, then actual (red when over). ✎ = adjusted by hand.</p>
      </div>
      {canEdit && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Rules per asset type">
            {types.map((t) => {
              const r = normalizeBudgetRules(t.budgetRules);
              return (
                <form key={t.id} action={saveBudgetRulesAction} className="mb-5 space-y-2 border-b border-gray-100 pb-4 last:border-0">
                  <input type="hidden" name="assetTypeId" value={t.id} />
                  <input type="hidden" name="year" value={year} />
                  <p className="text-sm font-medium">{t.name}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="PM cost / service" name="pmCostPerService"><Input name="pmCostPerService" defaultValue={r.pmCostPerService || ""} inputMode="decimal" /></Field>
                    <Field label="Parts / cavity / year" name="partsPerCavity"><Input name="partsPerCavity" defaultValue={r.partsPerCavity || ""} inputMode="decimal" /></Field>
                    <Field label="Refurbishment cost" name="refurbCost"><Input name="refurbCost" defaultValue={r.refurbCost || ""} inputMode="decimal" /></Field>
                    <Field label="Replacement cost" name="replacementCost"><Input name="replacementCost" defaultValue={r.replacementCost || ""} inputMode="decimal" /></Field>
                  </div>
                  <SubmitButton size="sm" variant="secondary">Save rules</SubmitButton>
                </form>
              );
            })}
          </Card>
          <div className="space-y-6">
            <Card title={`Generate ${year} budget`}>
              <form action={generateBudgetAction} className="space-y-3">
                <input type="hidden" name="year" value={year} />
                <Select name="assetTypeId" options={types.map((t) => [t.id, t.name] as [string, string])} aria-label="Asset type" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overwrite" /> Overwrite lines adjusted by hand</label>
                <p className="text-xs text-ink-500">PM = services forecast from each asset&apos;s plans and shot rate × cost per service. Refurbishment and replacement follow the life forecast for {year}.</p>
                <SubmitButton pendingText="Generating…">Generate</SubmitButton>
              </form>
            </Card>
            <Card title="Adjust a line">
              <form action={adjustBudgetAction} className="space-y-2">
                <input type="hidden" name="year" value={year} />
                <div className="grid grid-cols-2 gap-2">
                  <Input name="asset" placeholder="Asset number" aria-label="Asset number" required />
                  <Select name="category" options={BUDGET_CATEGORIES} aria-label="Category" />
                </div>
                <Input name="amount" inputMode="decimal" placeholder={`Amount (${ctx.org.currency})`} aria-label="Amount" required />
                <Input name="reason" placeholder="Reason" aria-label="Reason for adjustment" required />
                <SubmitButton size="sm" variant="secondary">Save adjustment</SubmitButton>
              </form>
            </Card>
          </div>
          <Card title="Adjustment history">
            <ul className="space-y-2 text-xs">
              {history.length === 0 && <li className="text-ink-500">No changes yet.</li>}
              {history.map((h) => {
                const before = (h.before as { amount?: number | null } | null)?.amount;
                const after = (h.after as { amount?: number } | null)?.amount;
                return (
                  <li key={h.id}>
                    <span className="font-medium">{h.entityLabel}</span>{h.action === "budget_adjusted" ? `: ${before != null ? money(before) : "—"} → ${money(after ?? 0)}` : " generated from rules"}
                    <span className="block text-ink-500">{h.user ? `${h.user.firstName} ${h.user.lastName}` : "System"} · {fmtDateTime(h.createdAt, ctx.org.timezone)}{h.reason && ` · ${h.reason}`}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
