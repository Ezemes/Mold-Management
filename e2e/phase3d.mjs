/**
 * Phase 3d acceptance suite: public API with scoped keys, webhooks (signed, retried), shot reconciliation,
 * OIDC and SAML single sign-on with group mapping, domain checks and enforcement.
 * Run against a FRESH seeded database and an app started with:
 *   APP_URL=http://localhost:3000 CRON_SECRET=… WEBHOOK_ALLOW_HTTP=1 WEBHOOK_ALLOW_PRIVATE=1 SSO_SKIP_DOMAIN_VERIFICATION=1
 *   DATABASE_URL=... CRON_SECRET=... npm run test:e2e:3d
 */
import { start, flash, B } from './lib.mjs';
import { startOidc, startReceiver, startSaml } from './mock-servers.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
const CRON = process.env.CRON_SECRET;
if (!URL_ || !CRON) throw new Error('Set DATABASE_URL and CRON_SECRET to the values the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e3d-'));
const out = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };

const OIDC_PORT = 4455, SAML_PORT = 4456, RX_PORT = 4466;
const oidc = await startOidc(OIDC_PORT, { clientId: 'pm-client', clientSecret: 'pm-secret-123' });
const saml = await startSaml(SAML_PORT, { acsUrl: `${B}/api/sso/saml/acs`, spEntityId: () => samlEntity, idpEntityId: 'urn:mock-idp' });
const recv = await startReceiver(RX_PORT);
let samlEntity = '';

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
const api = async (method, p, token, body) => {
  const r = await fetch(`${B}/api/v1${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ── Page sweep
await loginAs(page, 'admin@sharma.example');
const pages = ['/admin/integrations', '/admin/integrations?tab=webhooks', '/admin/integrations?tab=sso', '/reconciliation', '/reconciliation?view=reports', '/reconciliation?view=closed', '/reports/reconciliation', '/developers', '/admin/settings'];
const bad = [];
for (const p of pages) { const before = errors.length; const r = await page.goto(B + p); if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`); }
check(`[admin] ${pages.length} Phase 3d pages render without errors`, bad.length === 0, bad.join('; '));
const spec = await fetch(`${B}/api/v1/openapi.json`).then((r) => r.json());
check('OpenAPI document is public and lists the endpoints', spec.openapi === '3.0.3' && ['/assets', '/readings', '/production', '/events'].every((p) => p in spec.paths));

// ── API keys (created in the UI; token shown once)
async function newKey(name, scopes, sites = []) {
  await page.goto(B + '/admin/integrations');
  await page.fill('[name=name]', name);
  for (const s of scopes) await page.check(`[name=scopes][value="${s}"]`);
  for (const s of sites) await page.check(`label:has-text("${s}") [name=siteIds]`);
  await page.click('button:has-text("Create key")');
  const el = page.locator('[data-testid=one-time-secret]');
  await el.waitFor({ timeout: 15000 });
  return (await el.textContent()).trim();
}
const full = await newKey('MES integration', ['assets:read', 'readings:read', 'readings:write', 'transfers:read', 'work_orders:read', 'production:write', 'reconciliation:read', 'sites:read', 'events:read']);
const narrow = await newKey('Brightway portal', ['assets:read'], ['Brightway Chakan']);
check('API key is shown once and only its hash is stored', /^pmk_[A-Za-z0-9]+_[A-Za-z0-9_-]{30,}$/.test(full) && q(`select count(*) from "ApiKey" where hash like '%${full.split('_').pop().slice(0, 10)}%'`) === '0');

check('requests without a key are refused (401)', (await api('GET', '/assets')).status === 401);
check('a wrong key is refused (401)', (await api('GET', '/assets', full.slice(0, -2) + 'xx')).status === 401);
const molds = await api('GET', '/assets?type=mold', full);
check('GET /assets?type=mold lists the 7 molds with lifetime shots', molds.status === 200 && molds.json.data.length === 7 && molds.json.data.some((a) => a.number === 'M-0001' && a.life.lifetime_shots === 412000), `${molds.status} ${molds.json?.data?.length}`);
const p1 = await api('GET', '/assets?type=mold&limit=3', full);
const p2 = await api('GET', `/assets?type=mold&limit=3&cursor=${p1.json.next_cursor}`, full);
check('cursor pagination returns distinct pages', p1.json.data.length === 3 && p2.json.data.length === 3 && !p2.json.data.some((a) => p1.json.data.some((b) => b.id === a.id)));
const nar = await api('GET', '/assets?type=mold', narrow);
check('a key limited to Brightway Chakan sees only molds there', JSON.stringify(nar.json.data.map((a) => a.number).sort()) === JSON.stringify(['M-0004', 'M-0005']), nar.json.data.map((a) => a.number).join(','));
check('…and gets 404 for a mold elsewhere', (await api('GET', '/assets/M-0001', narrow)).status === 404);
const scopeErr = await api('POST', '/readings', narrow, { asset: 'M-0004', value: 1 });
check('a key without readings:write is refused (403 insufficient_scope)', scopeErr.status === 403 && scopeErr.json.error.code === 'insufficient_scope');

// ── Webhooks: endpoint created in the UI, test ping signed
await page.goto(B + '/admin/integrations?tab=webhooks');
await page.fill('[name=url]', `http://localhost:${RX_PORT}/hook`);
await page.fill('input[name=description]', 'Test receiver');
await page.click('button:has-text("Add endpoint")');
await page.locator('[data-testid=one-time-secret]').waitFor({ timeout: 15000 });
recv.rx.secret = (await page.locator('[data-testid=one-time-secret]').textContent()).trim();
const epId = q(`select id from "WebhookEndpoint" where url like '%/hook'`);
check('webhook secret is stored encrypted, not in clear', !q(`select "secretEnc" from "WebhookEndpoint" where id='${epId}'`).includes(recv.rx.secret));
await page.goto(B + `/admin/integrations/webhooks/${epId}`);
let f = await submit('button:has-text("Send test event")');
check('test event is delivered with a valid signature', f.includes('delivered') && recv.rx.received.some((r) => r.event === 'ping' && r.valid), f);

// ── Readings via the API: per-item results, idempotent retries, triggers fire
const later = new Date().toISOString();
const rd = await api('POST', '/readings', full, { readings: [
  { asset: 'M-0002', value: 411000, read_at: later, note: 'MES' },
  { asset: 'M-0001', value: 1000, read_at: later },
  { asset: 'NOPE-1', value: 5 },
] });
const byIdx = (i) => rd.json.results.find((r) => r.index === i);
check('POST /readings: valid reading created, backwards and unknown rejected per item', rd.status === 200 && byIdx(0).status === 'created' && byIdx(1).code === 'backwards' && byIdx(2).code === 'not_found', JSON.stringify(rd.json).slice(0, 200));
const again = await api('POST', '/readings', full, { readings: [{ asset: 'M-0002', value: 411000, read_at: later }] });
check('re-sending the same reading returns duplicate, not an error', again.json.results[0].status === 'duplicate' && q(`select count(*) from "MeterReading" where source='api'`) === '1');
check('API readings are audited with the key name', +q(`select count(*) from "AuditEvent" where action='reading_recorded' and reason like 'API key%MES integration%'`) === 1);
check('the API reading fired M-0002\'s maintenance trigger', +q(`select count(*) from "WorkOrder" w join "Asset" a on a.id=w."assetId" where a.number='M-0002' and source='trigger'`) === 1);
check('webhook threshold.crossed (maintenance_due) arrived signed', await until(() => recv.rx.received.some((r) => r.event === 'threshold.crossed' && r.body.data.kind === 'maintenance_due' && r.body.data.asset === 'M-0002' && r.valid)));
const rds = await api('GET', '/assets/M-0002/readings?limit=1', full);
check('GET readings shows the API reading first', rds.json.data[0].source === 'api' && rds.json.data[0].value === 411000);

// Work order closed → webhook
await page.goto(B + `/maintenance/work-orders/${q(`select id from "WorkOrder" where number='WO-00001'`)}`);
await page.fill('form:has(button:has-text("Cancel work order")) [name=reason]', 'Done during last refurbishment');
f = await submit('button:has-text("Cancel work order")');
check('work_order.closed webhook carries the cancellation', await until(() => recv.rx.received.some((r) => r.event === 'work_order.closed' && r.body.data.work_order === 'WO-00001' && r.body.data.status === 'cancelled' && r.valid)), f);
const wos = await api('GET', '/work-orders?status=cancelled', full);
check('GET /work-orders reflects it', wos.json.data.some((w) => w.number === 'WO-00001'));

// Transfer → transfer.status_changed
await page.goto(B + '/transfers/new');
await page.fill('[name=assets]', 'M-0007');
const toSite = await page.locator('[name=toSiteId] option', { hasText: 'Pune Plant 1' }).first().getAttribute('value');
await page.selectOption('[name=toSiteId]', toSite);
f = await submit('button:has-text("Create and submit")');
check('transfer.status_changed webhook on submit', await until(() => recv.rx.received.some((r) => r.event === 'transfer.status_changed' && r.body.data.assets.includes('M-0007'))), f);
const ev = await api('GET', '/events?type=transfer.status_changed', full);
check('GET /events returns the same event for polling', ev.json.data.some((e) => e.data.assets?.includes('M-0007')));

// Failing endpoint: retried later, error recorded
await page.goto(B + '/admin/integrations?tab=webhooks');
await page.fill('[name=url]', `http://localhost:${RX_PORT}/fail`);
await page.click('button:has-text("Add endpoint")');
await page.locator('[data-testid=one-time-secret]').waitFor({ timeout: 15000 });
const failId = q(`select id from "WebhookEndpoint" where url like '%/fail'`);
await page.goto(B + `/admin/integrations/webhooks/${failId}`);
f = await submit('button:has-text("Send test event")');
const fd = q(`select status||'|'||attempts||'|'||"lastStatusCode"||'|'||("nextAttemptAt" > now() + interval '50 seconds') from "WebhookDelivery" where "endpointId"='${failId}'`);
check('a failing endpoint records the error and schedules a retry (1 min)', f.includes('failed') && fd === 'pending|1|500|true', `${fd} / ${f}`);

// ── Shot reconciliation via the API
const rr = q(`select to_char(r."readAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'|'||r.lifetime from "MeterReading" r join "Meter" m on m.id=r."meterId" join "Asset" a on a.id=m."assetId" where a.number='M-0003' order by r."readAt"`).split('\n').map((l) => l.split('|'));
const counted = +rr[1][1] - +rr[0][1];
const prod = await api('POST', '/production', full, { reports: [
  { asset: 'M-0003', period_start: rr[0][0], period_end: rr[1][0], parts: counted * 8 + 400, part_number: '', reference: 'MES-1' },
  { asset: 'M-0003', period_start: rr[0][0], period_end: rr[1][0], parts: Math.round(counted * 8 * 0.8), part_number: 'TN-0003-A', reference: 'MES-2' },
  { asset: 'M-0001', period_start: new Date(Date.now() - 2 * 86400000).toISOString(), period_end: new Date(Date.now() - 3600000).toISOString(), parts: 1000 },
] });
const pr = (i) => prod.json.results[i];
check('production within tolerance is matched (counter ' + counted + ' shots)', pr(0).reconciliation === 'matched', JSON.stringify(pr(0)));
check('a 20% gap raises a reconciliation exception', pr(1).reconciliation === 'exception' && +q(`select count(*) from "ReconciliationException" where status='open'`) === 1, JSON.stringify(pr(1)));
check('a period without bracketing readings waits for them', pr(2).reconciliation === 'pending');
check('reconciliation.exception webhook arrived', await until(() => recv.rx.received.some((r) => r.event === 'reconciliation.exception' && r.body.data.asset === 'M-0003' && r.valid)));
const exs = await api('GET', '/reconciliation/exceptions?status=open', full);
check('GET /reconciliation/exceptions lists it', exs.json.data.length === 1 && exs.json.data[0].gap > 0);
await page.goto(B + '/reconciliation');
await page.fill('[name=resolution]', 'Trial shots after insert change, parts scrapped');
f = await submit('button:has-text("Accept gap")');
check('the exception is accepted with an explanation and audited', q(`select status from "ReconciliationException"`) === 'accepted' && +q(`select count(*) from "AuditEvent" where action='reconciliation_accepted'`) === 1, f);
await page.goto(B + '/reconciliation?view=reports');
await page.fill('[name=rows]', `M-0006, 01-09-2026, 07-09-2026, 5000, TN-0006-A, CSV-1`);
f = await submit('button:has-text("Import and reconcile")');
check('production CSV import (DD-MM-YYYY, end date inclusive)', f.includes('1 report(s) saved') && q(`select to_char("periodEnd" - "periodStart", 'DD')||'|'||source from "ProductionReport" where reference='CSV-1'`) === '07|import', f);

// Revoking stops the key
await page.goto(B + '/admin/integrations');
await page.locator('tr', { hasText: 'Brightway portal' }).locator('button:has-text("Revoke")').click();
await page.waitForURL(/ok=/);
const rv = await api('GET', '/assets', narrow);
check('a revoked key is refused (401 key_revoked)', rv.status === 401 && rv.json.error.code === 'key_revoked');

// ── OIDC single sign-on
await page.goto(B + '/admin/integrations?tab=sso');
const add = page.locator('form:has(button:has-text("Add connection"))');
await add.locator('[name=name]').fill('Mock OIDC');
await add.locator('[name=protocol]').selectOption('oidc');
await add.locator('[name=emailDomains]').fill('sso.example');
await add.locator('[name=oidcIssuer]').fill(`http://localhost:${OIDC_PORT}`);
await add.locator('[name=oidcClientId]').fill('pm-client');
await add.locator('[name=oidcClientSecret]').fill('pm-secret-123');
await add.locator('[name=groupMappings]').fill('PM-Admins | Org Admin | all\nPM-Pune | Technician | sites: PUN1\nBrightway-Staff | Supplier User | partner: Brightway Plastics');
await add.locator('[name=enabled]').check();
f = await submit('button:has-text("Add connection")');
check('a connection cannot be enabled before its domain is verified', f.includes('verify at least one domain') && q(`select enabled from "SsoConnection"`) === 'f', f);
f = await submit('button:has-text("Check DNS")');
const conn = page.locator('section', { hasText: 'Mock OIDC' }).first();
await conn.locator('[name=enabled]').check();
f = await submit('section:has-text("Mock OIDC") button:has-text("Save connection")');
check('domain verified and connection enabled', q(`select enabled||'|'||array_to_string("verifiedDomains", ',') from "SsoConnection"`) === 'true|sso.example', f);
check('the OIDC client secret is stored encrypted', q(`select "oidcClientSecretEnc" from "SsoConnection"`).startsWith('v1:') && !q(`select "oidcClientSecretEnc" from "SsoConnection"`).includes('pm-secret'));
await page.screenshot({ path: SH + '/pm-sso.png', fullPage: true });

async function ssoLogin(email) {
  await page.context().clearCookies();
  await page.goto(B + '/login/sso');
  await page.fill('[name=email]', email);
  await page.click('button:has-text("Continue")');
  await page.waitForURL((u) => u.pathname === '/dashboard' || u.pathname === '/login/sso' && u.search.includes('error'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  return page.url().includes('/dashboard') ? 'in' : decodeURIComponent(new URL(page.url()).searchParams.get('error') ?? '');
}
oidc.idp.user = { sub: 'oid-asha', email: 'asha@sso.example', first: 'Asha', last: 'Kulkarni', groups: ['PM-Pune', 'Everyone'] };
let r = await ssoLogin('asha@sso.example');
const ms = q(`select r.key||'|'||m."scopeType"||'|'||array_length(m."scopeIds",1) from "Membership" m join "User" u on u.id=m."userId" join "Role" r on r.id=m."roleId" where u.email='asha@sso.example'`);
check('OIDC sign-in creates the user with the mapped role and site scope', r === 'in' && ms === 'technician|sites|1', `${r} ${ms}`);
check('…linked to the IdP subject, with no password, and audited', q(`select count(*) from "SsoIdentity" where subject='oid-asha'`) === '1' && q(`select "passwordHash" is null from "User" where email='asha@sso.example'`) === 't' && +q(`select count(*) from "AuditEvent" where action='sso_provisioned'`) === 1);
oidc.idp.user = { ...oidc.idp.user, groups: ['PM-Admins'] };
r = await ssoLogin('asha@sso.example');
check('group changes at the IdP update the role at next sign-in', r === 'in' && q(`select r.key from "Membership" m join "User" u on u.id=m."userId" join "Role" r on r.id=m."roleId" where u.email='asha@sso.example'`) === 'org_admin');
oidc.idp.user = { sub: 'oid-ravi', email: 'ravi@sso.example', first: 'Ravi', last: 'S', groups: ['Contractors'] };
r = await ssoLogin('ravi@sso.example');
check('a user in no mapped group (no default role) is refused', r.includes('not in any group'), r);
oidc.idp.user = { sub: 'oid-evil', email: 'boss@sharma.example', first: 'X', last: 'Y', groups: ['PM-Admins'] };
r = await ssoLogin('mallory@sso.example');
check('an IdP asserting an email outside the verified domain is refused', r.includes('not in a verified domain'), r);
oidc.idp.user = { sub: 'oid-asha', email: 'asha@sso.example', first: 'Asha', last: 'K', groups: ['PM-Pune'] };
oidc.idp.idTokenOverride = { aud: 'someone-else' };
r = await ssoLogin('asha@sso.example');
oidc.idp.idTokenOverride = null;
check('an ID token for another client (wrong audience) is refused', r.includes('could not be verified'), r);
// Replaying a callback (same state) fails: capture the IdP redirect and use it twice.
await page.context().clearCookies();
let cb = null;
page.on('request', (rq) => { if (rq.url().includes('/api/sso/oidc/callback')) cb = rq.url(); });
await ssoLogin('asha@sso.example');
const replay = await fetch(cb, { redirect: 'manual' });
check('a replayed sign-in callback is refused', decodeURIComponent(replay.headers.get('location') ?? '').includes('already been used'));
// Login CSRF: a callback URL produced outside this browser (e.g. sent by an attacker) is refused.
const s1 = await fetch(`${B}/api/sso/start?email=asha@sso.example`, { redirect: 'manual' });
const authz = await fetch(s1.headers.get('location'), { redirect: 'manual' });
const forged = await fetch(authz.headers.get('location'), { redirect: 'manual' });
check('a sign-in callback from another browser is refused (login CSRF)', decodeURIComponent(forged.headers.get('location') ?? '').includes('different browser'));
check('unknown domains get a clear message', (await ssoLogin('who@nowhere.example')).includes("isn't set up"));

// Enforcement: password sign-in blocked for the domain, except org admins (break-glass)
await loginAs(page, 'admin@sharma.example');
await page.goto(B + '/admin/integrations?tab=sso');
await page.locator('section:has-text("Mock OIDC") [name=emailDomains]').fill('sso.example, sharma.example');
await page.locator('section:has-text("Mock OIDC") [name=enforce]').check();
await submit('section:has-text("Mock OIDC") button:has-text("Save connection")');
await submit('button:has-text("Check DNS")');
await page.context().clearCookies();
await page.goto(B + '/login');
await page.fill('[name=email]', 'tooling@sharma.example'); await page.fill('[name=password]', 'Demo@12345');
await page.click('button[type=submit]'); await page.waitForURL(/error=/);
check('enforced SSO blocks password sign-in for the domain', (await flash(page)).includes('single sign-on'));
await loginAs(page, 'admin@sharma.example');
check('org admins keep password sign-in as a break-glass', page.url().includes('/dashboard'));

// ── SAML single sign-on
await page.goto(B + '/admin/integrations?tab=sso');
const addS = page.locator('form:has(button:has-text("Add connection"))');
await addS.locator('[name=name]').fill('Mock SAML');
await addS.locator('[name=protocol]').selectOption('saml');
await addS.locator('[name=emailDomains]').fill('saml.example');
await addS.locator('[name=samlEntryPoint]').fill(saml.idp.entryPoint);
await addS.locator('[name=samlIdpIssuer]').fill(saml.idp.issuer);
await addS.locator('[name=samlIdpCert]').fill(saml.idp.cert);
await addS.locator('[name=groupMappings]').fill('Brightway-Staff | Supplier User | partner: Brightway Plastics');
f = await submit('button:has-text("Add connection")');
const samlId = q(`select id from "SsoConnection" where protocol='saml'`);
samlEntity = `${B}/sso/${samlId}`;
await submit('section:has-text("Mock SAML") button:has-text("Check DNS")');
await page.locator('section:has-text("Mock SAML") [name=enabled]').check();
f = await submit('section:has-text("Mock SAML") button:has-text("Save connection")');
const meta = await fetch(`${B}/api/sso/saml/metadata?connection=${samlId}`).then((x) => x.text());
check('SAML connection enabled; SP metadata names the ACS URL', q(`select enabled from "SsoConnection" where id='${samlId}'`) === 't' && meta.includes('/api/sso/saml/acs'), f);
saml.idp.user = { email: 'priya@saml.example', first: 'Priya', last: 'N', groups: ['Brightway-Staff'] };
r = await ssoLogin('priya@saml.example');
const sm = q(`select r.key||'|'||m."scopeType"||'|'||p.name from "Membership" m join "User" u on u.id=m."userId" join "Role" r on r.id=m."roleId" join "Partner" p on p.id=m."partnerId" where u.email='priya@saml.example'`);
check('SAML sign-in with a signed assertion provisions a supplier user for Brightway', r === 'in' && sm === 'supplier_user|partner|Brightway Plastics', `${r} ${sm}`);
await page.goto(B + '/assets?q=M-000');
check('…who sees only Brightway\'s molds', JSON.stringify(await page.locator('tbody tr td:first-child a').allTextContents()) === JSON.stringify(['M-0004', 'M-0005']));
saml.idp.tamper = true;
r = await ssoLogin('priya@saml.example');
saml.idp.tamper = false;
check('a tampered SAML assertion is refused', r.includes('could not be verified') && q(`select count(*) from "User" where email='boss@saml.example'`) === '0', r);

out('\nbrowser errors:', errors);
out('screenshots:', SH);
out(`\n${results.filter((x) => x[1]).length}/${results.length} checks passed`);
await browser.close();
oidc.close(); saml.close(); recv.close();
process.exit(0);
