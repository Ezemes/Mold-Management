/**
 * Calculated fields and inspections suite: the lifecycle/capacity calculations on the passport, the cost
 * table, calculated values in custom formulas, site shift patterns, inspection templates, the guided
 * step-by-step assessment (with video, photos and mandatory comments) and the health-rating outcomes.
 * Run against a FRESH seeded database and a running app:  DATABASE_URL=... npm run test:e2e:inspection
 */
import { start, flash, B } from './lib.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
if (!URL_) throw new Error('Set DATABASE_URL to the database the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e-insp-'));
const out = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
const submit = async (selector, re = /ok=|error=/) => {
  await page.evaluate(() => { const u = new URL(location.href); u.searchParams.delete('ok'); u.searchParams.delete('error'); history.replaceState(history.state, '', u); });
  await page.click(selector); await page.waitForURL(re, { timeout: 30000 }); await page.waitForLoadState('networkidle'); return flash(page);
};
const id = (n) => q(`select id from "Asset" where number='${n}'`);
const text = async () => (await page.locator('main').textContent()) ?? '';
const calcRow = (label) => page.locator('dl > div', { hasText: label }).first().locator('dd');

// ── Page sweep
await loginAs(page, 'admin@sharma.example');
const m1 = id('M-0001'), m6 = id('M-0006'), m7 = id('M-0007');
const pages = [`/assets/${m1}?tab=calculated`, `/assets/${m6}?tab=calculated`, `/assets/${m1}`, `/assets/${m1}/edit`, '/quality/templates', `/quality/templates?edit=${q(`select id from "InspectionTemplate" where name='Extrusion Blow'`)}`, '/quality/assess', `/quality/assess?asset=M-0001&mode=bench`, '/planning/forecast', '/reports/inspection_summary', '/reports/calculated_fields', '/admin/settings', `/admin/sites/${q(`select id from "Site" where code='CHE1'`)}`];
const bad = [];
for (const p of pages) { const before = errors.length; const r = await page.goto(B + p); if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`); }
check(`[admin] ${pages.length} pages render without errors`, bad.length === 0, bad.join('; '));

// ── Calculated fields (Calculated_Fields.docx)
await page.goto(B + `/assets/${m1}?tab=calculated`);
const daily = (await calcRow('Daily Output Capacity').textContent()).trim();
check('Daily Output Capacity = 3600 ÷ 45 s × 8 h × 3 shifts × 2 cavities × 0.85 = 3,264 parts', daily.startsWith('3,264'), daily);
check('Annual Output Capacity = daily × 6 days × 50 weeks = 9,79,200 parts', (await calcRow('Annual Output Capacity').textContent()).includes('9,79,200'));
check('Refurbs Remaining = 2 allowed − 0 completed', (await calcRow('Refurbs Remaining').textContent()).trim() === '2');
check('Refurbishment Priority is Critical (412,000 shots, first refurbishment due at 3,33,333)', (await calcRow('Refurbishment Priority').textContent()).includes('Critical'));
const life = (await calcRow('Remaining Life').textContent()).trim();
check('Remaining Life = 1 − 4,12,000 ÷ (3 × 3,33,333) = 58.8%', life.startsWith('58.8'), life);
check('Calculated Replacement Cost = $16,000 × 2 cavities (Injection, document default in USD)', (await calcRow('Calculated Replacement Cost').textContent()).includes('32,000'));
await page.goto(B + `/assets/${m6}?tab=calculated`);
const needs = (await calcRow('Daily Output Capacity').textContent()).trim();
check('a site without a shift pattern names the missing inputs', needs === 'Needs Hours per Shift, Shifts per Day, OEE', needs);
await page.goto(B + `/assets/${m1}`);
check('the passport overview shows the refurbishment priority', (await text()).includes('Refurbishment Priority') && (await text()).includes('Critical'));

// Site shift pattern fills the capacity fields
await page.goto(B + `/admin/sites/${q(`select id from "Site" where code='CHE1'`)}`);
for (const [k, v] of [['hoursPerShift', '8'], ['shiftsPerDay', '2'], ['daysPerWeek', '5'], ['weeksPerYear', '50'], ['oeePct', '85']]) await page.fill(`[name=${k}]`, v);
let f = await submit('button:has-text("Save")');
await page.goto(B + `/assets/${m6}?tab=calculated`);
check('after setting the Chennai shift pattern, M-0006 capacity is calculated (3600 ÷ 30 × 8 × 2 × 4 × 0.85)', (await calcRow('Daily Output Capacity').textContent()).trim().startsWith('6,528'), f);
await page.goto(B + `/admin/sites/${q(`select id from "Site" where code='CHE1'`)}`);
await page.fill('[name=hoursPerShift]', '13'); await page.fill('[name=shiftsPerDay]', '2');
f = await submit('button:has-text("Save")');
check('an impossible shift pattern (2 × 13 h) is refused', f.includes("can't exceed 24"), f);

// Cost table override in the organisation's currency
await page.goto(B + '/admin/settings');
await page.fill('[name=cavityCostCurrency]', 'INR');
await page.fill('[name="cavityCost.Injection"]', '1200000');
await submit('button:has-text("Save settings")');
await page.goto(B + `/assets/${m1}?tab=calculated`);
const repl = (await calcRow('Calculated Replacement Cost').textContent()).trim();
check('cost-per-cavity override in INR gives ₹24,00,000 for 2 cavities; refurb average is a third', repl.includes('24,00,000') && (await calcRow('Cost Average Refurb').textContent()).includes('8,00,000'), repl);

// Calculated values in a custom formula
const moldType = q(`select id from "AssetType" where key='mold'`);
await page.goto(B + `/admin/asset-types/${moldType}`);
const addF = page.locator('form:has(button:has-text("Add field"))');
await addF.locator('[name=label]').fill('Life left (rounded)');
await addF.locator('[name=key]').fill('life_left');
await addF.locator('[name=type]').selectOption('formula');
await addF.locator('[name=formula]').fill('round(remaining_life_pct, 0)');
f = await submit('button:has-text("Add field")');
await page.goto(B + `/assets/${m1}?tab=specs`);
const ll = await page.locator('dt:has-text("Life left (rounded)") + dd').textContent();
check('custom formulas can use calculated fields (round(remaining_life_pct, 0) = 59)', ll?.trim().startsWith('59'), `${ll} / ${f}`);

// Process is a standard field with the document's departments
await page.goto(B + `/assets/${m1}/edit`);
const procs = await page.locator('[name=process] option').allTextContents();
check('the passport has a Process (department) dropdown with the document\'s processes', ['Injection', 'Injection Blow', 'Extrusion Blow', 'Precision Injection', 'Two Part Epoxy'].every((p) => procs.includes(p)));

await page.goto(B + '/planning/forecast');
check('life forecast shows the calculated refurbishment priority', (await text()).includes('Critical'));

// ── Inspection templates
await page.goto(B + '/quality/templates');
const tpl = await text();
check('templates from the documents: Injection (25), Injection Blow (20), Extrusion Blow (13 with key points)', /Injection.*25/s.test(tpl) && tpl.includes('Injection Blow') && tpl.includes('Extrusion Blow') && tpl.includes('Unacceptable'));

// ── Guided assessment (Workflow-based Inspection) by the technician, on the bench with video
await loginAs(page, 'tech@sharma.example');
await page.goto(B + '/quality/assess');
await page.check('[name=mode][value=bench]');
await page.check('[name=video]');
await page.fill('[name=asset]', 'M-0007');
await page.click('button:has-text("Start assessment")');
await page.waitForURL(/mode=bench/); await page.waitForLoadState('networkidle');
check('M-0007 (Extrusion Blow) gets the Extrusion Blow template', (await text()).includes('Extrusion Blow'));
await page.waitForSelector('text=● Recording', { timeout: 10000 }).catch(() => {});
check('bench assessment records video in the background', await page.locator('text=● Recording').count() === 1);
const steps = JSON.parse(q(`select components::text from "InspectionTemplate" where name='Extrusion Blow'`));
const next = () => page.locator('button', { hasText: /Start inspection|Next element|Next: questions|Review/ }).click();
const alertText = async () => ((await page.locator('[role=alert]').first().textContent().catch(() => '')) ?? '');

// Details step
await page.fill('[name=cavitiesRunning]', '7');
await page.fill('[name=annualVolume]', '5000000');
await page.check('[name=qualityIssues][value=no]', { force: true });
await next();
for (const [i, c] of steps.entries()) {
  for (let k = 0; k < c.checks.length; k++) await page.check(`[name="c.${c.key}.${k}"][value="${i === 0 && k === 0 ? 'no' : 'yes'}"]`, { force: true });
  await page.check(`[name="r.${c.key}"][value="${c.key === 'cavity' ? '1' : '4'}"]`, { force: true });
  if (i === 0) {
    await next();
    const a = await alertText();
    check('a NO answer needs a comment and a photo before moving on', a.includes('comment is required') && a.includes('add a photo'), a);
    await page.fill(`[name="n.${c.key}"]`, 'Blow pin bent at the tip');
    await page.setInputFiles(`[name="p.${c.key}"]`, { name: 'blowpin.png', mimeType: 'image/png', buffer: PNG });
  }
  if (c.key === 'cavity') {
    await next();
    check('an Unacceptable rating needs an explanation', (await alertText()).includes('explain the Unacceptable rating'));
    await page.fill(`[name="n.${c.key}"]`, 'Crack across the parting line; repair before running');
  }
  await next();
}
// Questions
await page.check('[name=operationalIssues][value=no]', { force: true });
await page.check('[name=spareParts][value=Need]');
await page.fill('[name=sparePartsNote]', '2 × blow pins');
await page.check('[name=supplyRisk][value=no]', { force: true });
await page.fill('[name=overallCondition]', 'Generally good; cavity cracked.');
await next();
check('review lists the Unacceptable component and warns', (await text()).includes('should not run until corrected'));
await page.screenshot({ path: SH + '/pm-assess-review.png', fullPage: true });
await page.click('button:has-text("Submit assessment")');
await page.waitForURL(/\/quality\/evaluations\//, { timeout: 60000 }); await page.waitForLoadState('networkidle');
const ev = q(`select id from "ConditionEvaluation" where "assetId"='${m7}'`);
const row = JSON.parse(q(`select json_build_object('score', score, 'mode', mode, 'scores', scores, 'answers', answers)::text from "ConditionEvaluation" where id='${ev}'`));
check('assessment stored: 13 components, checks, comments, bench mode', row.scores.length === 13 && row.mode === 'bench' && row.scores[0].checkResults[0].ok === false && row.scores[0].note.includes('bent'));
check('the component photo is linked to its component', row.scores[0].photoIds.length === 1 && q(`select "mimeType" from "Attachment" where id='${row.scores[0].photoIds[0]}'`) === 'image/png');
check('the bench video was recorded and stored', +q(`select count(*) from "Attachment" where "ownerId"='${ev}' and "mimeType" like 'video/%'`) === 1);
check('weighted score (12 × 4 + 1) ÷ 13 = 3.77', Math.abs(row.score - 3.77) < 0.01, String(row.score));
check('Unacceptable is alerted to approvers and maintenance at once', +q(`select count(*) from "Notification" where kind='unacceptable_condition'`) >= 1);

// Approval applies the outcome
await loginAs(page, 'admin@sharma.example');
await page.goto(B + `/quality/evaluations/${ev}`);
check('the evaluation page shows the NO answer, the rating words and the video', (await text()).includes('✗ NO') && (await text()).includes('1 · Unacceptable') && (await page.locator('video').count()) === 1);
f = await submit('button:has-text("Approve")');
const a7 = q(`select status||'|'||"annualVolume"||'|'||coalesce("conditionScore"::text,'') from "Asset" where id='${m7}'`);
check('approval quarantines M-0007 (Unacceptable) and applies the annual volume', a7.startsWith('quarantined|5000000|3.77'), `${a7} / ${f}`);
check('…with a release work order that lists the findings', q(`select "clearsQuarantine"||'|'||(description like '%Cavity: Unacceptable%') from "WorkOrder" where "assetId"='${m7}'`) === 'true|true');
check('spare parts “Need” notifies inventory', +q(`select count(*) from "Notification" where kind='spare_parts_needed'`) >= 1);

// A Poor rating (no Unacceptable) raises a corrective work order
await page.goto(B + `/quality/assess?asset=M-0006&mode=machine`);
check('M-0006 (Injection Blow) uses the 20-component template; machine mode has no video', (await text()).includes('Injection Blow') && (await page.locator('text=● Recording').count()) === 0);
const ibm = JSON.parse(q(`select components::text from "InspectionTemplate" where name='Injection Blow'`));
await page.check('[name=qualityIssues][value=no]', { force: true });
await next();
for (const c of ibm) {
  await page.check(`[name="r.${c.key}"][value="${c.key === 'core_rods' ? '2' : c.key === 'pick_off' ? 'na' : '5'}"]`, { force: true });
  if (c.key === 'core_rods') await page.fill(`[name="n.${c.key}"]`, 'Worn; replace two rods');
  await next();
}
await page.check('[name=operationalIssues][value=no]', { force: true });
await page.check('[name=spareParts][value=Okay]');
await page.check('[name=supplyRisk][value=no]', { force: true });
await page.fill('[name=overallCondition]', 'Good apart from core rods.');
await next();
await page.click('button:has-text("Submit assessment")');
await page.waitForURL(/\/quality\/evaluations\//, { timeout: 60000 }); await page.waitForLoadState('networkidle');
f = await submit('button:has-text("Approve")');
check('a Poor rating raises a corrective work order (not a quarantine)', q(`select status from "Asset" where id='${m6}'`) === 'active' && q(`select type||'|'||source from "WorkOrder" where "assetId"='${m6}' and source='evaluation'`) === 'corrective|evaluation', f);

// ── Reports
await page.goto(B + '/reports/inspection_summary');
const sum = await text();
check('inspection summary has the Summary-sheet columns', ['Supplier Tool #', 'Next Evaluation Date', 'Refurbs Remaining', 'New W/O Req Yes or No', 'Product Drawing #', 'Ownership'].every((c) => sum.includes(c)));
check('…and marks M-0007 as needing a work order', ((await page.locator('tbody tr', { hasText: 'M-0007' }).textContent()) ?? '').includes('Yes'));
const csv = await page.request.get(B + '/reports/calculated_fields/export');
const body = await csv.text();
check('calculated fields export to CSV with every field and the missing inputs', csv.status() === 200 && body.includes('Daily Output Capacity') && body.includes('Missing inputs') && body.includes('M-0001'));

out('\nbrowser errors:', errors);
out('screenshots:', SH);
out(`\n${results.filter(r => r[1]).length}/${results.length} checks passed`);
await browser.close();
