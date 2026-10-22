/**
 * Phase 3c acceptance suite (spec §12 criterion 4, plus qualification, condition evaluation, spare parts,
 * planning, reports and supplier limits). Run against a FRESH seeded database and a running app:
 *   DATABASE_URL=... npm run test:e2e:3c
 */
import { start, flash, B } from './lib.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
if (!URL_) throw new Error('Set DATABASE_URL to the database the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e3c-'));
const out = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function loginAs(page, email) {
  await page.context().clearCookies();
  await page.goto(B + '/login');
  await page.fill('[name=email]', email); await page.fill('[name=password]', 'Demo@12345');
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

const { browser, page, errors } = await start();
const _goto = page.goto.bind(page);
page.goto = async (u, o) => { const r = await _goto(u, o); await page.waitForLoadState('networkidle'); return r; };
// Clear the previous flash from the URL first, so we read the message this submit produces.
const submit = async (selector, re = /ok=|error=/) => {
  await page.evaluate(() => { const u = new URL(location.href); u.searchParams.delete('ok'); u.searchParams.delete('error'); history.replaceState(history.state, '', u); });
  await page.click(selector); await page.waitForURL(re, { timeout: 30000 }); await page.waitForLoadState('networkidle'); return flash(page);
};
const id = (n) => q(`select id from "Asset" where number='${n}'`);
const row = (text) => page.locator('tbody tr', { hasText: text }).first();

// ── Page sweep
await loginAs(page, 'admin@sharma.example');
const m1 = id('M-0001'), m3 = id('M-0003'), p1 = id('P-0001');
const partId = q(`select id from "Part" where number='EJ-6X150'`);
const pages = ['/presses', '/presses/finder', '/presses/finder?mold=M-0003', '/presses/finder?press=P-0002', '/presses/approved', '/quality', '/quality?view=due', '/quality?view=recent', '/quality/evaluations/new', `/quality/evaluations/new?asset=${m3}`,
  '/quality/qualifications', '/quality/qualifications/new', `/quality/qualifications/${q(`select id from "Qualification" limit 1`)}`, '/quality/criteria', '/inventory', '/inventory?new=1', `/inventory/parts/${partId}`, '/inventory/stock', '/inventory/ledger', '/inventory/reorder',
  '/planning/forecast', '/planning/forecast?within=90', '/planning/capacity', '/planning/budget', '/reports', ...['fleet_status', 'custody', 'life', 'approaching', 'maintenance_cost', 'budget', 'transit', 'data_quality'].map((k) => `/reports/${k}`),
  `/assets/${m1}?tab=presses`, `/assets/${m1}?tab=quality`, `/assets/${p1}?tab=presses`, `/assets/${p1}`, '/admin/settings', '/dashboard'];
const bad = [];
for (const p of pages) {
  const before = errors.length;
  const r = await page.goto(B + p);
  if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`);
}
check(`[admin] ${pages.length} Phase 3c pages render without errors`, bad.length === 0, bad.join('; '));

// ── Acceptance 4: a mold needing 450 t is excluded from a 400 t press, with the reason
await page.goto(B + '/presses/finder?mold=M-0003');
const p3row = (await row('P-0003').textContent()) ?? '';
check('finder: M-0003 is incompatible with the 400 t press P-0003 and says why', p3row.includes('Incompatible') && p3row.includes('Needs 450 t, press has 400 t'), p3row.slice(0, 160));
check('finder: the only failed rule on P-0003 is tonnage', (await row('P-0003').locator('ul.text-red-700 li').count()) === 1);
check('finder: the 450 t press P-0002 is compatible', ((await row('P-0002').textContent()) ?? '').includes('Compatible'));
await page.screenshot({ path: SH + '/pm-finder.png', fullPage: true });
await page.goto(B + '/presses/finder?mold=M-0001');
check('finder: the qualified pair M-0001 / P-0001 shows as approved', ((await row('P-0001').textContent()) ?? '').includes('Approved'));

// Rules are configurable: switching tonnage off makes P-0003 compatible; switch it back on.
await page.goto(B + '/admin/settings');
await page.uncheck('[name="rule.tonnage"]');
let f = await submit('button:has-text("Save settings")');
await page.goto(B + '/presses/finder?mold=M-0003');
const off = (await row('P-0003').textContent()) ?? '';
await page.goto(B + '/admin/settings');
await page.check('[name="rule.tonnage"]');
await submit('button:has-text("Save settings")');
check('compatibility rules are configurable in settings', !off.includes('Incompatible') && q(`select "compatRules"->'enabled'->>'tonnage' from "Organisation" limit 1`) === 'true', f);

// ── Qualification: blocked on an incompatible press; IQ → OQ → PQ on P-0002 approves the pair
await loginAs(page, 'tooling@sharma.example');
await page.goto(B + '/quality/qualifications/new');
await page.fill('[name=asset]', 'M-0003'); await page.fill('[name=press]', 'P-0003');
f = await submit('button:has-text("Start qualification")');
check('qualification on an incompatible press is refused with the reason', f.includes('not compatible') && f.includes('Clamp tonnage'), f);
await page.fill('[name=asset]', 'M-0003'); await page.fill('[name=press]', 'P-0002');
f = await submit('button:has-text("Start qualification")');
const qid = q(`select id from "Qualification" where "assetId"='${m3}'`);
check('qualification Q-0002 starts with IQ, OQ and PQ', !!qid && +q(`select count(*) from "QualificationStage" where "qualificationId"='${qid}'`) === 3, f);
for (const st of ['IQ', 'OQ', 'PQ']) {
  await page.fill('[name=result]', `${st} done: all checks within limits`);
  f = await submit(`button:has-text("Pass ${st}")`);
}
check('passing PQ approves M-0003 on P-0002', q(`select status from "Qualification" where id='${qid}'`) === 'passed' && q(`select status from "MoldPress" where "moldId"='${m3}' and "pressId"='${id('P-0002')}'`) === 'approved', f);

// ── Condition evaluation: notes required for low scores; approval below threshold raises a work order
await loginAs(page, 'tech@sharma.example');
const m2 = id('M-0002');
await page.goto(B + `/quality/evaluations/new?asset=${m2}`);
const scores = { parting_line: '2', cavity_surfaces: '3', vents: '2', cooling: '3', ejectors: '3', slides: '4', guiding: '4' };
for (const [k, v] of Object.entries(scores)) await page.selectOption(`[name="score.${k}"]`, v);
f = await submit('button:has-text("Submit for approval")');
check('scores of 2 or below need a note', f.includes('Add a note'), f);
for (const [k, v] of Object.entries(scores)) await page.selectOption(`[name="score.${k}"]`, v);
await page.fill('[name="note.parting_line"]', 'Flash marks along the parting line');
await page.fill('[name="note.vents"]', 'Vents blocked with residue');
f = await submit('button:has-text("Submit for approval")');
const ev = q(`select id||'|'||score from "ConditionEvaluation" where "assetId"='${m2}'`);
check('weighted score skips N/A: (2×3 + 3×3 + 2×2 + 3×2 + 3×2 + 4 + 4) / 14 = 2.79', ev.endsWith('|2.79'), `${ev} / ${f}`);
await loginAs(page, 'admin@sharma.example');
await page.goto(B + `/quality/evaluations/${ev.split('|')[0]}`);
f = await submit('button:has-text("Approve")');
const after = q(`select coalesce("conditionScore",0)||'|'||("nextEvaluationDate" > now()) from "Asset" where id='${m2}'`);
check('approval updates the passport score and schedules the next evaluation', after === '2.79|true', after);
check('a score below 3 raises a corrective work order', q(`select source from "WorkOrder" where id=(select "workOrderId" from "ConditionEvaluation" where "assetId"='${m2}')`) === 'evaluation', f);

// ── Spare parts: issue to a work order, shortage refused, return on removal, receipt clears the reorder list
await loginAs(page, 'tooling@sharma.example');
await page.goto(B + '/inventory/reorder');
check('reorder list suggests 17 thermocouples (3 on hand, max 20)', ((await row('HR-TC-J').textContent()) ?? '').includes('17'));
const csv = await page.request.get(B + '/inventory/reorder/export');
check('purchase request exports as CSV', csv.status() === 200 && (await csv.text()).includes('HR-TC-J'));
await page.goto(B + `/maintenance/work-orders/new?asset=M-0001`);
await page.selectOption('[name=type]', 'modification');
await page.fill('[name=title]', 'Add a second ejector row');
f = await submit('button:has-text("Create work order")');
const woId = q(`select id from "WorkOrder" where type='modification'`);
await page.goto(B + `/maintenance/work-orders/${woId}`);
const opt = await page.locator('[name=partId] option', { hasText: 'EJ-6X150' }).getAttribute('value');
await page.selectOption('[name=partId]', opt); await page.fill('form:has([name=partId]) [name=quantity]', '100');
f = await submit('button:has-text("Issue from stock")');
check('issuing more than is in stock is refused', f.includes('Only 40'), f);
await page.selectOption('[name=partId]', opt); await page.fill('form:has([name=partId]) [name=quantity]', '4');
f = await submit('button:has-text("Issue from stock")');
const stockAt = () => q(`select quantity from "Stock" where "partId"='${partId}'`);
check('issuing 4 pins deducts stock and links the ledger to the work order', stockAt() === '36' && q(`select count(*) from "StockMove" where kind='issue' and "workOrderId"='${woId}'`) === '1', f);
f = await submit('form:has([name=kind][value=part]) button:has-text("Remove")');
check('removing the line returns the pins to stock', stockAt() === '40' && q(`select count(*) from "StockMove" where kind='return'`) === '1', f);
await page.selectOption('[name=partId]', opt); await page.fill('form:has([name=partId]) [name=quantity]', '2');
await submit('button:has-text("Issue from stock")');

// Completing a modification flags re-qualification and withdraws the approved press pair.
await page.fill('[name=resolution]', 'Second ejector row added');
f = await submit('button:has-text("Complete work order")');
check('completing a modification withdraws M-0001\'s approved pair and flags re-qualification', q(`select status from "MoldPress" where "moldId"='${m1}'`) === 'revoked' && q(`select "requalificationReason" from "Asset" where id='${m1}'`).startsWith('Modified by'), f);
await page.goto(B + `/assets/${m1}`);
check('the passport shows the re-qualification notice', ((await page.locator('main').textContent()) ?? '').includes('Re-qualification required'));

await page.goto(B + `/inventory/parts/${q(`select id from "Part" where number='HR-TC-J'`)}`);
await page.selectOption('form:has(button:has-text("Receive")) [name=siteId]', { label: 'Pune Plant 1' });
await page.fill('form:has(button:has-text("Receive")) [name=quantity]', '17');
await page.fill('form:has(button:has-text("Receive")) [name=reference]', 'PO-4471');
f = await submit('button:has-text("Receive")');
await page.goto(B + '/inventory/reorder');
check('receiving 17 takes the thermocouple off the reorder list', (await row('HR-TC-J').count()) === 0, f);

// ── Planning
await page.goto(B + '/planning/forecast?within=90');
check('life forecast flags M-0005 (95% used) within 90 days', ((await page.locator('tbody').textContent()) ?? '').includes('M-0005'));
await page.goto(B + '/planning/capacity');
const shortBase = +(await page.locator('text=Shortfall months').locator('..').locator('div.text-2xl').textContent());
check('capacity plan shows shortfalls once M-0005 reaches end of life', shortBase > 0, `${shortBase}`);
const now = new Date(); const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
await page.goto(B + `/planning/capacity?hpart=TN-0005-A&hcav=16&hcycle=14&hfrom=${ym}`);
const shortWhatIf = +(await page.locator('text=Shortfall months').locator('..').locator('div.text-2xl').textContent());
check('what-if: an extra 16-cavity mold for TN-0005-A removes the shortfall', shortWhatIf < shortBase, `${shortBase} → ${shortWhatIf}`);
await page.screenshot({ path: SH + '/pm-capacity.png', fullPage: true });
await page.goto(B + '/planning/capacity');
await page.fill('[name=rows]', `TN-0001-A, ${ym}, 55000`);
f = await submit('button:has-text("Save demand")');
check('demand import updates a month', q(`select quantity from "ProductDemand" where "partNumber"='TN-0001-A' and month='${ym}-01'`) === '55000', f);

await page.goto(B + '/planning/budget');
f = await submit('button:has-text("Generate")');
const lines = +q(`select count(*) from "BudgetItem" where year=${now.getUTCFullYear()}`);
check('budget generates from the mold rules', lines > 0 && f.includes('generated'), `${lines} / ${f}`);
await page.fill('form:has(button:has-text("Save adjustment")) [name=asset]', 'M-0001');
await page.selectOption('form:has(button:has-text("Save adjustment")) [name=category]', 'pm');
await page.fill('form:has(button:has-text("Save adjustment")) [name=amount]', '99000');
await page.fill('form:has(button:has-text("Save adjustment")) [name=reason]', 'Extra PM after modification');
f = await submit('button:has-text("Save adjustment")');
await submit('button:has-text("Generate")');
check('a manual adjustment survives regeneration and is audited', q(`select amount||'|'||source from "BudgetItem" b join "Asset" a on a.id=b."assetId" where a.number='M-0001' and category='pm'`) === '99000.00|manual' && +q(`select count(*) from "AuditEvent" where action='budget_adjusted'`) === 1, f);

// ── Reports
await page.goto(B + '/reports/approaching');
check('report: approaching lists M-0005', ((await page.locator('tbody').textContent()) ?? '').includes('M-0005'));
await page.goto(B + '/reports/data_quality');
check('report: data quality shows a fleet score', /Fleet score: \d+%/.test((await page.locator('main').textContent()) ?? ''));
let exportsOk = true;
for (const k of ['fleet_status', 'custody', 'life', 'approaching', 'maintenance_cost', 'budget', 'transit', 'data_quality']) { const r = await page.request.get(B + `/reports/${k}/export`); if (r.status() !== 200 || !(r.headers()['content-type'] ?? '').includes('text/csv')) exportsOk = false; }
check('all 8 reports export to CSV', exportsOk);

// ── Supplier limits
await loginAs(page, 'supplier@brightway.example');
for (const p of ['/planning/capacity', '/inventory', '/reports']) { await page.goto(B + p); if (!page.url().includes('forbidden')) check(`supplier blocked from ${p}`, false, page.url()); }
check('supplier is blocked from planning, inventory and reports', true);
await page.goto(B + '/presses');
const supPresses = await page.locator('tbody tr td:first-child a').allTextContents();
check('supplier sees only presses at its own sites', JSON.stringify(supPresses) === JSON.stringify(['P-0004']), supPresses.join(','));
await page.goto(B + `/quality/evaluations/new?asset=${id('M-0004')}`);
await page.selectOption('[name="score.parting_line"]', '4');
f = await submit('button:has-text("Submit for approval")');
check('supplier can submit a condition evaluation on a mold it holds', f.includes('submitted'), f);
const e2 = errors.length;
const other = await page.goto(B + `/quality/evaluations/new?asset=${m1}`);
check('supplier cannot evaluate a mold it does not hold', ((await page.locator('main').textContent()) ?? '').includes('No asset'), String(other.status()));
errors.splice(e2);

out('\nbrowser errors:', errors);
out('screenshots:', SH);
out(`\n${results.filter(r => r[1]).length}/${results.length} checks passed`);
await browser.close();
