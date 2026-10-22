/**
 * Phase 3b acceptance suite (spec §12 criteria 2, 3 and 6, plus work orders, quarantine, supplier work and alerts).
 * Run against a FRESH database seeded with `npm run db:seed` and an app started with CRON_SECRET set:
 *   DATABASE_URL=... CRON_SECRET=... npm run test:e2e:3b
 */
import { start, flash, B } from './lib.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
const CRON = process.env.CRON_SECRET;
if (!URL_ || !CRON) throw new Error('Set DATABASE_URL and CRON_SECRET to the values the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e3b-'));
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
const cron = async () => (await fetch(B + '/api/cron/daily', { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } })).json();

const { browser, page, errors } = await start();
const _goto = page.goto.bind(page);
page.goto = async (u, o) => { const r = await _goto(u, o); await page.waitForLoadState('networkidle'); return r; };
// Clear the previous flash from the URL first, so we read the message this submit produces.
const submit = async (selector, re = /ok=|error=/) => {
  await page.evaluate(() => { const u = new URL(location.href); u.searchParams.delete('ok'); u.searchParams.delete('error'); history.replaceState(history.state, '', u); });
  await page.click(selector); await page.waitForURL(re, { timeout: 30000 }); await page.waitForLoadState('networkidle'); return flash(page);
};
const id = (n) => q(`select id from "Asset" where number='${n}'`);
const woId = (n) => q(`select id from "WorkOrder" where number='${n}'`);

// ── Page sweep
await loginAs(page, 'admin@sharma.example');
const m1 = id('M-0001');
const pages = ['/transfers', '/transfers?view=all', '/transfers/new', `/transfers/new?asset=${m1}`, '/maintenance', '/maintenance?view=all', '/maintenance/plans', '/maintenance/templates', '/maintenance/reports', '/maintenance/work-orders/new', `/maintenance/work-orders/${woId('WO-00001')}`, `/maintenance/work-orders/${woId('WO-00002')}`, '/notifications', `/assets/${m1}?tab=maintenance`, `/assets/${m1}?tab=custody`, '/dashboard'];
const bad = [];
for (const p of pages) {
  const before = errors.length;
  const r = await page.goto(B + p);
  if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`);
}
check(`[admin] ${pages.length} Phase 3b pages render without errors`, bad.length === 0, bad.join('; '));

// ── Acceptance 3 (part 1): the daily job warns before a plan falls due, and is idempotent
const c1 = await cron();
const c2 = await cron();
check('daily job warns once for the plan at 91% (M-0002) and repeats nothing on a second run', c1.warned === 1 && c2.warned === 0 && c2.readingAlerts === 0 && c2.woAlerts === 0, JSON.stringify([c1, c2]));
check('daily job does not raise a second work order while one is open (M-0004)', c1.raised === 0 && +q(`select count(*) from "WorkOrder" w join "Asset" a on a.id=w."assetId" where a.number='M-0004'`) === 1);
check('daily job rejects calls without the secret', (await fetch(B + '/api/cron/daily', { method: 'POST' })).status === 401);

// ── Acceptance 3 (part 2): a reading that crosses the interval raises one work order, after the warning
await loginAs(page, 'tech@sharma.example');
const m2 = id('M-0002');
await page.goto(B + `/assets/${m2}?tab=counter`);
await page.fill('[name=value]', '411000');
check('technician records 411,000 shots on M-0002', (await submit('button:has-text("Save reading")')).includes('Reading saved'));
const m2wo = q(`select w.number||'|'||source||'|'||coalesce("dueAtShots",0) from "WorkOrder" w join "Asset" a on a.id=w."assetId" where a.number='M-0002'`);
check('crossing 410,000 shots raises a PM work order from the trigger', /^WO-\d+\|trigger\|410000$/.test(m2wo), m2wo);
const order = q(`select string_agg(kind, ',' order by "createdAt") from "Notification" n where n."userId"=(select id from "User" where email='tech@sharma.example') and kind like 'pm_%'`);
check('the technician was warned (due soon) before the work order (due)', order === 'pm_due_soon,pm_due', order);
const c3 = await cron();
check('re-checking triggers does not raise a duplicate', c3.raised === 0 && +q(`select count(*) from "WorkOrder" w join "Asset" a on a.id=w."assetId" where a.number='M-0002'`) === 1);

// ── Work order: checklist enforcement, out-of-range measurement, sign-off, plan reset, follow-up
const wo2 = q(`select w.id from "WorkOrder" w join "Asset" a on a.id=w."assetId" where a.number='M-0002'`);
await page.goto(B + `/maintenance/work-orders/${wo2}`);
await submit('button:has-text("Start work")');
check('technician starts the work order', q(`select status from "WorkOrder" where id='${wo2}'`) === 'in_progress');
let f = await submit('button:has-text("Complete work order")');
check('completion is blocked while required checks are empty', f.includes('Complete the required items'), f);
for (const t of ['t1', 't2', 't3', 't5']) await page.selectOption(`[name="${t}.result"]`, 'pass');
await page.fill('[name="t4.value"]', '14.5');
await page.fill('[name="hours"]', '3'); await page.fill('[name="rate"]', '450');
await submit('button:has-text("Add labour")');
check('labour is logged against the work order', q(`select hours||'|'||rate from "WorkOrderLabor" where "workOrderId"='${wo2}'`) === '3|450.00');
// the labour form reloaded the page, so fill the checklist again
for (const t of ['t1', 't2', 't3', 't5']) await page.selectOption(`[name="${t}.result"]`, 'pass');
await page.fill('[name="t4.value"]', '14.5');
await page.setInputFiles('[name=photos]', { name: 'core.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
f = await submit('button:has-text("Complete work order")');
const wo2row = q(`select status||'|'||"signedByName"||'|'||round("passPct")||'|'||"shotsAtCompletion" from "WorkOrder" where id='${wo2}'`);
check('work order completes with signature; 14.5 l/min fails the 8–12 range', wo2row === 'completed|Suresh Patil|80|411000', `${wo2row} / ${f}`);
check('the plan restarts from the completion count', q(`select "baselineShots"||'|'||("warnedAt" is null) from "MaintenancePlan" p join "Asset" a on a.id=p."assetId" where a.number='M-0002'`) === '411000|true');
const follow = q(`select number||'|'||type||'|'||source from "WorkOrder" where "sourceId"='${wo2}'`);
check('a corrective follow-up is raised for the failed check', /^WO-\d+\|corrective\|checklist_failure$/.test(follow), `${follow} / ${f}`);
check('the photo is stored as a work-order attachment', +q(`select count(*) from "Attachment" where "ownerType"='work_order' and "ownerId"='${wo2}'`) === 1);
await page.screenshot({ path: SH + '/pm-wo-followup.png', fullPage: true });

// ── Quarantine raises a release work order; only completing it lifts the quarantine
await loginAs(page, 'tooling@sharma.example');
const m6 = id('M-0006');
await page.goto(B + `/assets/${m6}`);
await page.selectOption('form:has([name=status]) [name=status]', 'quarantined');
await page.fill('form:has([name=status]) [name=reason]', 'Crack found near sprue bush');
f = await submit('form:has([name=status]) button[type=submit]');
const qwo = q(`select id from "WorkOrder" w where "clearsQuarantine" and "assetId"='${m6}'`);
check('quarantine raises a release work order', !!qwo && f.includes('must be completed'), f);
await page.selectOption('form:has([name=status]) [name=status]', 'active');
f = await submit('form:has([name=status]) button[type=submit]');
check('the quarantine cannot be lifted by hand', f.includes('lifted by completing') && q(`select status from "Asset" where id='${m6}'`) === 'quarantined', f);
await page.goto(B + `/maintenance/work-orders/${qwo}`);
for (const t of ['q1', 'q2', 'q3']) await page.selectOption(`[name="${t}.result"]`, 'pass');
f = await submit('button:has-text("Complete work order")');
check('completing the release work order returns the mold to active', q(`select status from "Asset" where id='${m6}'`) === 'active', f);

// ── Acceptance 2: transfer to a supplier, handover counts, dispute, resolution
await page.goto(B + `/transfers/new?asset=${m1}`);
await page.fill('[name=assets]', 'M-0001');
await page.selectOption('[name=toSiteId]', { label: 'Brightway Chakan' }).catch(async () => {
  const opt = await page.locator('[name=toSiteId] option', { hasText: 'Brightway Chakan' }).first().getAttribute('value');
  await page.selectOption('[name=toSiteId]', opt);
});
f = await submit('button:has-text("Create and submit")');
const tid = q(`select id from "Transfer" order by "createdAt" desc limit 1`);
check('cross-company transfer needs approval (policy: cross-company)', q(`select status from "Transfer" where id='${tid}'`) === 'requested', f);
await loginAs(page, 'admin@sharma.example');
await page.goto(B + `/transfers/${tid}`);
f = await submit('button:has-text("Approve")');
check('admin approves the transfer', q(`select status from "Transfer" where id='${tid}'`) === 'approved', f);
await loginAs(page, 'tooling@sharma.example');
await page.goto(B + `/transfers/${tid}`);
const item = q(`select id from "TransferItem" where "transferId"='${tid}'`);
await page.fill(`[name="${item}.shots"]`, '412500');
await page.fill('[name=carrier]', 'VRL Logistics'); await page.fill('[name=vehicleNumber]', 'mh12ab1234'); await page.fill('[name=ewayBillNumber]', '331000000001');
f = await submit('button:has-text("Record dispatch")');
check('dispatch records the outbound count; status in transit; sender still custodian', q(`select t.status||'|'||a.status||'|'||coalesce(a."custodianPartnerId",'org') from "Transfer" t join "TransferItem" i on i."transferId"=t.id join "Asset" a on a.id=i."assetId" where t.id='${tid}'`) === 'in_transit|in_transfer|org', f);
check('vehicle number stored in upper case', q(`select "vehicleNumber" from "Transfer" where id='${tid}'`) === 'MH12AB1234');

await loginAs(page, 'supplier@brightway.example');
await page.goto(B + `/transfers/${tid}`);
await page.fill(`[name="${item}.shots"]`, '430000');
await page.check(`[name="${item}.tagVerified"]`);
f = await submit('button:has-text("Confirm receipt")');
const recv = q(`select t.status||'|'||a.status||'|'||p.name from "Transfer" t join "TransferItem" i on i."transferId"=t.id join "Asset" a on a.id=i."assetId" join "Partner" p on p.id=a."custodianPartnerId" where t.id='${tid}'`);
check('supplier confirms receipt; custody passes to Brightway', recv === 'disputed|active|Brightway Plastics', `${recv} / ${f}`);
check('a 17,500-shot gap between dispatch and receipt is raised as a dispute', q(`select kind from "Dispute" d join "TransferItem" i on i.id=d."itemId" where i."transferId"='${tid}'`) === 'shot_mismatch');
check('the receipt reading also fires M-0001\'s 50k plan (430,000 ≥ 420,000)', +q(`select count(*) from "WorkOrder" where "assetId"='${m1}' and source='trigger'`) === 1);

await loginAs(page, 'admin@sharma.example');
await page.goto(B + `/transfers/${tid}`);
await page.fill('[name=resolution]', 'Brightway ran trial shots on arrival; counts confirmed with photos.');
f = await submit('button:has-text("Resolve")');
check('resolving the dispute completes the transfer', q(`select status from "Transfer" where id='${tid}'`) === 'completed', f);

// ── Acceptance 6: custody changes are audited and visible on the passport
const aud = q(`select string_agg(action, ',' order by "createdAt") from "AuditEvent" where ("entityType"='transfer' and "entityId"='${tid}') or ("entityType"='asset' and "entityId"='${m1}' and action in ('dispatched','custody_transferred'))`);
check('every custody step is in the audit log', ['created', 'submitted', 'approved', 'dispatched', 'shipped', 'custody_transferred', 'received_with_dispute', 'dispute_resolved'].every((a) => aud.split(',').includes(a)), aud);
await page.goto(B + `/assets/${m1}?tab=custody`);
const chain = await page.locator('main').textContent();
const tnum = q(`select number from "Transfer" where id='${tid}'`);
check('chain of custody shows the transfer with both handover counts', chain.includes(tnum) && chain.includes('Brightway Plastics') && /4,12,500/.test(chain) && /4,30,000/.test(chain));
await page.screenshot({ path: SH + '/pm-custody.png', fullPage: true });

// ── Supplier works on maintenance for molds it holds; no access to others
await loginAs(page, 'supplier@brightway.example');
await page.goto(B + '/maintenance');
const supWos = await page.locator('tbody tr td:first-child a').allTextContents();
check('supplier sees work orders on molds in its custody', supWos.includes('WO-00001') && !supWos.includes('WO-00002'), supWos.join(','));
check('supplier has no plan or template management tabs', (await page.locator('a[href="/maintenance/plans"]').count()) === 0);
const w1 = woId('WO-00001');
await page.goto(B + `/maintenance/work-orders/${w1}`);
f = await submit('button:has-text("Start work")');
check('supplier starts its assigned work order', q(`select status from "WorkOrder" where id='${w1}'`) === 'in_progress', f);
const errBefore = errors.length;
const other = await page.goto(B + `/maintenance/work-orders/${woId('WO-00002')}`);
errors.splice(errBefore); // the 404 is the expected outcome
check('supplier cannot open a work order on a mold it does not hold (404)', other.status() === 404);
const r = await page.request.get(B + `/attachments/${q(`select id from "Attachment" where "ownerType"='work_order' limit 1`)}`);
check('supplier cannot download another site\'s work-order photo', r.status() === 404);

// ── Alerts page
await loginAs(page, 'tooling@sharma.example');
await page.goto(B + '/notifications');
const alerts = await page.locator('main li').count();
check('alerts page lists unread notifications', alerts > 0, `${alerts}`);
await page.click('button:has-text("Mark all as read")'); await page.waitForURL(/ok=/);
check('mark all as read clears the unread count', +q(`select count(*) from "Notification" where "userId"=(select id from "User" where email='tooling@sharma.example') and "readAt" is null`) === 0);

// ── Reports
await page.goto(B + '/maintenance/reports?days=90');
const rep = await page.locator('main').textContent();
check('compliance report shows MTTR and spend', rep.includes('MTTR') && rep.includes('Maintenance spend'));
await page.screenshot({ path: SH + '/pm-reports.png', fullPage: true });

out('\nbrowser errors:', errors);
out('screenshots:', SH);
out(`\n${results.filter(r => r[1]).length}/${results.length} checks passed`);
await browser.close();
