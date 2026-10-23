/**
 * Downtime suite (spec §4.9): recording, overlap and time checks, MTBF / MTTR / availability, reason codes,
 * the work-order link (completing the work order ends the downtime), CSV import and export, the API,
 * webhook events and scoping for technicians and suppliers.
 * Run against a FRESH seeded database and a running app:  DATABASE_URL=... npm run test:e2e:downtime
 */
import { start, flash, B } from './lib.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
if (!URL_) throw new Error('Set DATABASE_URL to the database the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e-dt-'));
const out = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
/** Wall-clock time in Asia/Kolkata `h` hours from now, as a datetime-local value. */
const ist = (h = 0) => new Date(Date.now() + h * 3_600_000 + 330 * 60_000).toISOString().slice(0, 16);
/** Same, as the CSV import expects (DD-MM-YYYY HH:MM). */
const istCsv = (h) => { const [d, t] = ist(h).split('T'); const [y, m, dd] = d.split('-'); return `${dd}-${m}-${y} ${t}`; };

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
const events = (type) => Number(q(`select count(*) from "OutboundEvent" where type='${type}'`));
const api = async (method, p, token, body) => {
  const r = await fetch(`${B}/api/v1${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
async function record({ asset, code, from, to = '', press = '', wo = '', description = '', raise = false }) {
  await page.goto(B + `/downtime/new?asset=${asset}`);
  const v = await page.locator('[name=codeId] option', { hasText: `${code} ·` }).first().getAttribute('value');
  await page.selectOption('[name=codeId]', v);
  await page.fill('[name=startedAt]', from);
  await page.fill('[name=endedAt]', to);
  if (press) await page.fill('[name=press]', press);
  if (wo) await page.fill('[name=workOrder]', wo);
  if (description) await page.fill('textarea[name=description]', description);
  if (raise) await page.check('[name=raiseWorkOrder]');
  return submit('button:has-text("Record downtime")');
}

// ── Page sweep
await loginAs(page, 'admin@sharma.example');
const m3 = id('M-0003'), p2 = id('P-0002');
const dt1 = q(`select id from "DowntimeEvent" where number='DT-00001'`);
const pages = ['/downtime', '/downtime?view=all', '/downtime?view=recent&category=failure', '/downtime/new', '/downtime/new?asset=M-0003', `/downtime/${dt1}`, '/downtime/reports', '/downtime/reports?by=type', '/downtime/reports?by=site&days=365', '/downtime/codes',
  `/assets/${m3}?tab=downtime`, `/assets/${p2}?tab=downtime`, '/maintenance/reports', '/reports', '/reports/availability', '/reports/downtime_events', '/dashboard', '/import-export', '/developers'];
const bad = [];
for (const p of pages) { const before = errors.length; const r = await page.goto(B + p); if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`); }
check(`[admin] ${pages.length} pages render without errors`, bad.length === 0, bad.join('; '));

// ── Metrics from the seeded history
await page.goto(B + '/downtime/reports?days=90');
const row3 = (await page.locator('tbody tr', { hasText: 'M-0003' }).first().textContent()) ?? '';
// Tracked from the earliest event (75 days ago): 1,800 h; failure + planned = 5 + 8 + 48 + 1.5 = 62.5 h.
check('M-0003 availability = (1,800 − 62.5) ÷ 1,800 = 96.5%', row3.includes('96.5%'), row3);
check('M-0003 MTTR = (5 + 8 + 48) ÷ 3 = 20 h 20 min; MTBF = 1,737.5 ÷ 3 h = 24 d 3 h', row3.includes('20 h 20 min') && row3.includes('24 d 3 h'), row3);
const row1 = (await page.locator('tbody tr', { hasText: 'M-0001' }).first().textContent()) ?? '';
check('external downtime (press fault) is shown but does not reduce M-0001 availability below planned-only', row1.includes('6 h') && !row1.includes('96.5%'), row1);
const pareto = await page.locator('table').nth(1).textContent();
check('reasons are ranked by hours lost (parts out of spec first)', pareto.trim().indexOf('QUAL') < pareto.indexOf('PRESS'), pareto.slice(0, 120));
await page.goto(B + '/downtime');
check('Down now lists M-0005 (seeded open hot-runner fault)', (await text()).includes('M-0005') && (await text()).includes('Still down'));
check('the sidebar shows one mold down', ((await page.locator('nav a', { hasText: 'Downtime' }).textContent()) ?? '').includes('1'));
await page.goto(B + '/maintenance/reports?days=90');
check('maintenance compliance takes MTBF and MTTR from downtime', (await text()).includes('From downtime'));

// ── Recording, with a work order raised from the downtime
await loginAs(page, 'tooling@sharma.example');
let f = await record({ asset: 'M-0002', code: 'COOL', from: ist(-2), press: 'P-0001', description: 'Leak at cavity 2 circuit', raise: true });
const dtA = q(`select id from "DowntimeEvent" where "assetId"='${id('M-0002')}' and "endedAt" is null`);
const woA = q(`select "workOrderId" from "DowntimeEvent" where id='${dtA}'`);
check('recording a failure with "raise a work order" links a new corrective work order', !!dtA && q(`select type||'|'||source||'|'||priority from "WorkOrder" where id='${woA}'`) === 'corrective|downtime|high', f);
check('…the press is recorded and the category is copied from the code', q(`select category||'|'||(select number from "Asset" where id="pressId") from "DowntimeEvent" where id='${dtA}'`) === 'failure|P-0001');
check('…maintenance at the site is notified that the mold is down', Number(q(`select count(*) from "Notification" n join "User" u on u.id=n."userId" where u.email='tech@sharma.example' and n.kind='mold_down'`)) === 1);
check('…and a downtime.started event is queued for webhooks', events('downtime.started') === 1);
f = await record({ asset: 'M-0002', code: 'EJECT', from: ist(-1) });
check('a second open event on the same mold is refused', f.includes('is still open'), f);
f = await record({ asset: 'M-0001', code: 'CHANGE', from: ist(-1), to: ist(-2) });
check('the end must be after the start', f.includes('after the start'), f);
f = await record({ asset: 'M-0001', code: 'CHANGE', from: ist(3) });
check('downtime cannot start in the future', f.includes('future'), f);
f = await record({ asset: 'M-0001', code: 'CHANGE', from: ist(-12 * 24 + 1), to: ist(-12 * 24 + 3) });
check('overlapping a recorded event is refused, naming it', /overlaps DT-0000\d/.test(f), f);
f = await record({ asset: 'M-0002', code: 'COOL', from: ist(-5), to: ist(-4), raise: true });
check('a work order can only be raised while the mold is still down', f.includes('still down'), f);

// Completing the work order ends the downtime.
await page.goto(B + `/maintenance/work-orders/${woA}`);
check('the work order shows the linked downtime', (await text()).includes('(mold down)'));
await page.fill('[name=resolution]', 'Replaced O-ring on circuit 2');
f = await submit('button:has-text("Complete work order")');
check('completing the work order ends the linked downtime', q(`select ("endedAt" is not null)::text from "DowntimeEvent" where id='${dtA}'`) === 'true', f);
check('…and queues downtime.ended', events('downtime.ended') === 1);

// ── Technician: scope and permissions
await loginAs(page, 'tech@sharma.example');
f = await record({ asset: 'M-0001', code: 'CHANGE', from: ist(-3), to: ist(-2), description: 'Changeover' });
check('a technician records a planned stop on a mold at their site', f.includes('recorded'), f);
f = await record({ asset: 'M-0004', code: 'CHANGE', from: ist(-3), to: ist(-2) });
check('…but not on a mold outside their sites', f.includes('not in your scope'), f);
await page.goto(B + '/downtime/new?asset=M-0001');
check('…and cannot raise work orders (no maintenance create permission)', (await page.locator('[name=raiseWorkOrder]').count()) === 0);
await page.goto(B + '/downtime?view=all');
check('…and only sees downtime in their scope', !(await text()).includes('M-0005') && (await text()).includes('M-0003'));
await page.goto(B + '/downtime/codes');
check('…and cannot change reason codes', (await page.locator('button:has-text("Add")').count()) === 0);

// ── Corrections, ending and deleting (admin)
await loginAs(page, 'admin@sharma.example');
const dt5 = q(`select id from "DowntimeEvent" where number='DT-00008'`);
await page.goto(B + '/downtime?view=open');
f = await submit('tr:has-text("M-0005") button:has-text("Back up")');
check('"Back up" ends an open event from the list', q(`select ("endedAt" is not null)::text from "DowntimeEvent" where id='${dt5}'`) === 'true', f);
await page.goto(B + `/downtime/${dt1}`);
await page.fill('form:has([name=reason]) [name=startedAt]', ist(-75 * 24 - 1));
// The browser requires a reason; remove that to check the server enforces it too.
await page.evaluate(() => document.querySelectorAll('[required]').forEach((e) => e.removeAttribute('required')));
f = await submit('button:has-text("Save changes")');
check('a correction needs a reason', f.includes('Say why'), f);
await page.fill('form:has([name=reason]) [name=startedAt]', ist(-75 * 24 - 1));
await page.fill('form:has(button:has-text("Save changes")) [name=reason]', 'Leak was found an hour earlier');
f = await submit('button:has-text("Save changes")');
check('the correction is saved and kept in the event history', f.includes('updated') && q(`select reason from "AuditEvent" where "entityType"='downtime' and "entityId"='${dt1}' and action='downtime_edited'`) === 'Leak was found an hour earlier', f);
check('…the history appears on the event page', (await text()).includes('edited'));

await page.goto(B + '/downtime/codes');
await page.fill('[aria-label="New code"]', 'guide');
await page.fill('[aria-label="New name"]', 'Broken guide pin');
await page.selectOption('[aria-label="New category"]', 'failure');
f = await submit('button:has-text("Add")');
check('admins add reason codes (upper-cased)', q(`select category from "DowntimeCode" where code='GUIDE'`) === 'failure', f);
await page.fill('[aria-label="New code"]', 'GUIDE');
await page.fill('[aria-label="New name"]', 'Duplicate');
f = await submit('button:has-text("Add")');
check('duplicate codes are refused', f.includes('already exists'), f);
await page.locator('form:has([aria-label="Code MATL"])').locator('[name=active]').uncheck();
f = await submit('form:has([aria-label="Code MATL"]) button:has-text("Save")');
await page.goto(B + '/downtime/new');
check('switched-off codes are not offered', (await page.locator('[name=codeId] option', { hasText: 'MATL ·' }).count()) === 0 && (await page.locator('[name=codeId] option', { hasText: 'GUIDE ·' }).count()) === 1);

const dt7 = q(`select id from "DowntimeEvent" where number='DT-00007'`);
await page.goto(B + `/downtime/${dt7}`);
await page.fill('form:has(button:has-text("Delete event")) [name=reason]', 'Recorded against the wrong mold');
f = await submit('button:has-text("Delete event")');
check('an event can be deleted with a reason, which is audited', q(`select count(*) from "DowntimeEvent" where id='${dt7}'`) === '0' && q(`select reason from "AuditEvent" where action='downtime_deleted'`) === 'Recorded against the wrong mold', f);

// ── CSV import (dry run, then apply) and export
const header = 'number,code,started_at,ended_at,press,work_order,description';
fs.writeFileSync(SH + '/dt-bad.csv', [header, `M-0006,HR,${istCsv(-48)},${istCsv(-46)},P-0003,,Zone 2`, `M-0006,NOPE,${istCsv(-30)},${istCsv(-29)},,,`, `M-0006,COOL,${istCsv(-47)},${istCsv(-45)},,,overlaps row 2`, `M-9999,HR,${istCsv(-30)},,,,`].join('\n'));
await page.goto(B + '/import-export');
await page.selectOption('[name=kind]', 'downtime');
await page.setInputFiles('[name=file]', SH + '/dt-bad.csv');
await page.click('button:has-text("Validate")'); await page.waitForURL(/import-export\/c/);
const rep = await text();
check('the dry run reports unknown codes, unknown molds and rows that overlap each other', rep.includes('unknown code "NOPE"') && rep.includes('M-9999') && rep.includes('overlaps row 2'), rep.slice(0, 300));
fs.writeFileSync(SH + '/dt-good.csv', [header, `M-0006,HR,${istCsv(-48)},${istCsv(-46)},P-0003,,Zone 2 heater`, `M-0006,PM,${istCsv(-30)},${istCsv(-26)},,,Quarterly PM`].join('\n'));
await page.goto(B + '/import-export');
await page.selectOption('[name=kind]', 'downtime');
await page.setInputFiles('[name=file]', SH + '/dt-good.csv');
await page.click('button:has-text("Validate")'); await page.waitForURL(/import-export\/c/);
f = await submit('button:has-text("Apply import")');
check('valid rows import as events with source "import"', q(`select count(*) from "DowntimeEvent" where source='import' and "assetId"='${id('M-0006')}'`) === '2', f);
const exp = await page.request.get(B + '/import-export/downtime.csv');
const expBody = await exp.text();
check('downtime exports to CSV in the import columns', exp.status() === 200 && expBody.replace(/^\uFEFF/, '').startsWith('number,code,started_at,ended_at') && expBody.includes('Zone 2 heater'));
const rcsv = await (await page.request.get(B + '/reports/availability/export')).text();
check('the MTBF and availability report exports to CSV', rcsv.includes('Availability %') && rcsv.includes('M-0003'));

// ── API
async function newKey(name, scopes) {
  await page.goto(B + '/admin/integrations');
  await page.fill('[name=name]', name);
  for (const s of scopes) await page.check(`[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Create key")');
  const el = page.locator('[data-testid=one-time-secret]');
  await el.waitFor({ timeout: 15000 });
  return (await el.textContent()).trim();
}
const key = await newKey('MES downtime', ['downtime:read', 'downtime:write']);
const readOnly = await newKey('BI reporting', ['assets:read']);
check('a key without the downtime scope is refused (403)', (await api('GET', '/downtime', readOnly)).status === 403);
let r = await api('POST', '/downtime', key, { asset: 'M-0006', code: 'eject', started_at: new Date(Date.now() - 3_600_000).toISOString(), press: 'P-0003', description: 'Ejector plate stuck' });
const num = r.json?.data?.number;
check('POST /downtime records an open event (201)', r.status === 201 && r.json.data.open === true && r.json.data.category === 'failure' && r.json.data.press === 'P-0003', JSON.stringify(r.json));
r = await api('POST', '/downtime', key, { asset: 'M-0006', code: 'HR', started_at: new Date(Date.now() - 1_800_000).toISOString() });
check('…a second open event on the same mold conflicts (409)', r.status === 409, JSON.stringify(r.json));
r = await api('POST', '/downtime', key, { asset: 'M-0006', code: 'XYZ', started_at: new Date().toISOString() });
check('…an unknown code is a 400', r.status === 400);
r = await api('GET', '/downtime?open=true&asset=M-0006', key);
check('GET /downtime filters open events by asset', r.status === 200 && r.json.data.length === 1 && r.json.data[0].number === num);
r = await api('PATCH', `/downtime/${num}`, key, { ended_at: new Date().toISOString() });
check('PATCH /downtime/{number} ends it', r.status === 200 && r.json.data.open === false && r.json.data.duration_hours >= 0.99, JSON.stringify(r.json));
check('…a second PATCH conflicts (409)', (await api('PATCH', `/downtime/${num}`, key, {})).status === 409);
check('GET /downtime/{number} returns the event', (await api('GET', `/downtime/${num}`, key)).json?.data?.source === 'api');
const spec = await fetch(`${B}/api/v1/openapi.json`).then((x) => x.json());
check('the OpenAPI document lists the downtime endpoints and webhook events', '/downtime' in spec.paths && 'patch' in spec.paths['/downtime/{number}'] && 'downtime.ended' in spec['x-webhooks'].events);

// ── Supplier: sees downtime on molds in their custody only
await loginAs(page, 'supplier@brightway.example');
await page.goto(B + '/downtime?view=all');
const sup = await text();
check('[supplier] sees downtime on molds in their custody and nothing else', sup.includes('M-0005') && !sup.includes('M-0003') && !sup.includes('M-0006'));
await page.goto(B + '/downtime/codes');
check('[supplier] cannot change reason codes', (await page.locator('button:has-text("Add")').count()) === 0);

out('\nbrowser errors:', errors);
out(`\n${results.filter(r => r[1]).length}/${results.length} checks passed`);
await browser.close();
