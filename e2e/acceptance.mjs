/**
 * Phase 3a acceptance suite (spec §12 criteria 1, 5, 7 plus scoping, documents and audit).
 * Run against a FRESH database seeded with `npm run db:seed` and a running app:
 *   DATABASE_URL=... npm run test:e2e
 * Requires psql on PATH (used to read state and to verify the audit trigger).
 */
import { start, flash, B } from './lib.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.DATABASE_URL;
if (!URL_) throw new Error('Set DATABASE_URL to the database the app under test uses');
const q = (s) => execSync(`psql -At ${JSON.stringify(URL_)} -c ${JSON.stringify(s)}`).toString().trim();
const SH = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e-'));
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
async function sweep(page, errors, paths, tag) {
  const bad = [];
  for (const p of paths) {
    const before = errors.length;
    const r = await page.goto(B + p);
    await page.waitForLoadState('networkidle');
    if (r.status() >= 400 || errors.length > before) bad.push(`${p} -> ${r.status()} ${errors.slice(before).join(' | ')}`);
  }
  check(`[${tag}] ${paths.length} pages render without errors`, bad.length === 0, bad.join('; '));
}

const { browser, page, errors } = await start();
const _goto = page.goto.bind(page);
page.goto = async (u, o) => { const r = await _goto(u, o); await page.waitForLoadState('networkidle'); return r; };
const id = (n) => q(`select id from "Asset" where number='${n}' and "deletedAt" is null`);

// ── Org admin: page sweep, custom field, formula, import 1000 molds (acceptance 1)
await loginAs(page, 'admin@sharma.example');
const m1 = id('M-0001');
const moldTypeId = q(`select id from "AssetType" where key='mold'`);
await sweep(page, errors, ['/dashboard', '/assets', '/assets?overdue=1', '/assets/new', `/assets/${m1}`, `/assets/${m1}?tab=specs`, `/assets/${m1}?tab=components`, `/assets/${m1}?tab=counter`, `/assets/${m1}?tab=documents`, `/assets/${m1}?tab=history`, `/assets/${m1}/edit`, `/assets/${m1}/tag`, '/scan', '/import-export', '/admin/sites', '/admin/partners', '/admin/asset-types', `/admin/asset-types/${moldTypeId}`, '/admin/users', '/admin/roles', '/admin/audit', '/admin/settings', '/profile'], 'admin');
await page.goto(B + `/assets/${m1}?tab=specs`);
const pph = await page.locator('dt:has-text("Parts per hour") + dd').textContent();
check('formula field computes parts/hour = 2 cav × 3600 / 45 s', pph?.trim().startsWith('160'), pph);
await page.screenshot({ path: SH + '/pm-passport-specs.png', fullPage: true });

await page.goto(B + `/admin/asset-types/${moldTypeId}`);
await page.locator('form:has(button:has-text("Add field")) [name=label]').fill('Customer tool ID');
await page.locator('form:has(button:has-text("Add field")) [name=key]').fill('customer_tool_id');
await page.locator('form:has(button:has-text("Add field")) [name=type]').selectOption('text');
await page.click('button:has-text("Add field")'); await page.waitForURL(/ok=/);
check('admin adds a custom field to the Mold type', (await flash(page)).includes('customer_tool_id'), await flash(page));
await page.locator('form:has(button:has-text("Add field")) [name=label]').fill('Bad formula');
await page.locator('form:has(button:has-text("Add field")) [name=type]').selectOption('formula');
await page.locator('form:has(button:has-text("Add field")) [name=formula]').fill('nonexistent_var * 2');
await page.click('button:has-text("Add field")'); await page.waitForURL(/error=/);
check('formula with unknown variable is rejected', (await flash(page)).includes('Unknown variable'), await flash(page));

const header = 'number,type,name,site,location,owner,program,design_cavities,design_cycle_time_s,warranty_shots,end_of_life_shots,build_date,cf_steel_grade,cf_customer_tool_id';
const lines = [header];
for (let i = 1; i <= 1000; i++) lines.push(`MX-${String(i).padStart(4, '0')},mold,Imported mold ${i},${i % 3 === 0 ? 'BW-CHK' : 'PUN1'},Rack ${i % 40},,Program ${i % 7},${(i % 4) + 1},${20 + (i % 15)},"5,00,000","10,00,000",${String((i % 28) + 1).padStart(2, '0')}-03-2024,${['P20', 'H13', 'S136'][i % 3]},CT-${i}`);
fs.writeFileSync(SH + '/molds-1000.csv', lines.join('\n'));
const bad = [header, 'MX-9001,mold,Bad steel,PUN1,,,,2,30,,,,Tungsten,', 'MX-9002,mold,,PUN1,,,,2,30,,,,P20,', 'MX-9003,mold,Bad date,PUN1,,,,2,30,,,31-02-2024,P20,', 'MX-9004,mold,No site,Nowhere,,,,2,30,,,,P20,'];
fs.writeFileSync(SH + '/molds-bad.csv', bad.join('\n'));
await page.goto(B + '/import-export');
await page.setInputFiles('[name=file]', SH + '/molds-bad.csv');
await page.click('button:has-text("Validate")'); await page.waitForURL(/import-export\/c/);
const badRows = await page.locator('tbody tr td:first-child').allTextContents();
check('dry run reports row-level errors and blocks apply', badRows.join(',') === '2,3,4,5' && (await page.locator('button:has-text("Apply import")').count()) === 0, `rows ${badRows.join(',')}`);
await page.screenshot({ path: SH + '/pm-import-errors.png', fullPage: true });
await page.goto(B + '/import-export');
await page.setInputFiles('[name=file]', SH + '/molds-1000.csv');
let t = Date.now();
await page.click('button:has-text("Validate")'); await page.waitForURL(/import-export\/c/, { timeout: 120000 });
check('1,000-row file validates with 0 errors', (await page.locator('text=All 1000 rows are valid').count()) === 1, `${Date.now() - t} ms`);
t = Date.now();
await page.click('button:has-text("Apply import")'); await page.waitForURL(/ok=/, { timeout: 300000 });
const applied = await flash(page);
check('apply imports 1,000 molds in one transaction', applied.includes('1000 created'), `${applied} (${Date.now() - t} ms)`);
check('imported molds get meters and cavities; partner-site rows land in partner custody', q(`select count(*) from "Asset" a join "Meter" m on m."assetId"=a.id where a.number like 'MX-%'`) === '1000' && q(`select count(*) from "Asset" a join "Partner" p on p.id=a."custodianPartnerId" where a.number like 'MX-%' and p.name='Brightway Plastics'`) === '333', q(`select count(*) from "Cavity" c join "Asset" a on a.id=c."assetId" where a.number like 'MX-%'`) + ' cavities');
const mx7 = id('MX-0007');
await page.goto(B + `/assets/${mx7}?tab=specs`);
check('imported passport shows custom values (steel grade, customer tool id)', (await page.content()).includes('CT-7') && (await page.locator('dt:has-text("Steel grade") + dd').textContent()) === 'H13');
const exp = await page.request.get(B + '/import-export/assets.csv?q=MX-0007');
const expText = await exp.text();
check('export round-trips import columns', expText.includes('MX-0007,mold,Imported mold 7') && expText.includes('cf_customer_tool_id'), expText.split('\r\n')[1]?.slice(0, 80));

// Create and edit through the forms (regression: empty non-nullable fields)
await page.goto(B + `/assets/new?type=${moldTypeId}`);
await page.fill('[name=name]', 'Form-created mold');
await page.selectOption('[name=siteId]', { label: 'Pune Plant 1' });
await page.fill('[name=design_cavities]', '4'); await page.fill('[name=design_cycle_time_s]', '30');
await page.click('button:has-text("Create")');
const createdOk = await page.waitForURL(/\/assets\/c[a-z0-9]+\?ok=/, { timeout: 15000 }).then(() => true).catch(() => false);
check('asset created through the form gets a number, meter and cavities', createdOk && q(`select count(*) from "Cavity" c join "Asset" a on a.id=c."assetId" where a.name='Form-created mold'`) === '4');
await page.goto(page.url().split('?')[0] + '/edit');
await page.fill('[name=refurbs_done]', ''); await page.fill('[name=warranty_shots]', '4,00,000');
await page.click('button:has-text("Save")');
const editedOk = await page.waitForURL(/tab=specs&ok=/, { timeout: 15000 }).then(() => true).catch(() => false);
check('edit form saves (empty refurbishments → 0, lakh-grouped number parsed)', editedOk && q(`select "warrantyShots" || '/' || "refurbsDone" from "Asset" where name='Form-created mold'`) === '400000/0');

// Document upload / download
await page.goto(B + `/assets/${m1}?tab=documents`);
fs.writeFileSync(SH + '/trial.pdf', '%PDF-1.4\n% test trial report\n');
await page.locator('form:has(button:has-text("Upload")) [name=title]').fill('Mold trial report T1');
await page.locator('form:has(button:has-text("Upload")) [name=category]').selectOption('trial_report');
await page.locator('form:has(button:has-text("Upload")) [name=file]').setInputFiles(SH + '/trial.pdf');
await page.click('button:has-text("Upload")'); await page.waitForURL(/ok=/);
await page.locator('form:has(button:has-text("New version")) [name=file]').first().setInputFiles(SH + '/trial.pdf');
await page.click('button:has-text("New version")'); await page.waitForURL(/v2%20uploaded/);
const vlink = await page.locator('a[href^="/files/"]').first().getAttribute('href');
const dl = await page.request.get(B + vlink);
check('documents are versioned and downloadable', (await flash(page)).includes('v2') && dl.status() === 200 && (await dl.text()).startsWith('%PDF'), await flash(page));

// Status change requires reason
await page.goto(B + `/assets/${id('M-0006')}`);
await page.selectOption('form:has(button:has-text("Update status")) [name=status]', 'quarantined');
await page.click('button:has-text("Update status")'); await page.waitForURL(/error=/);
check('quarantine without reason is rejected', (await flash(page)).includes('reason'));

// QR tag renders an SVG code
await page.goto(B + `/assets/${m1}/tag`);
check('QR tag page renders a QR code', (await page.locator('svg path').count()) > 0);
await page.screenshot({ path: SH + '/pm-tag.png' });

// ── Technician: scope + QR + readings (acceptance 5)
await loginAs(page, 'tech@sharma.example');
await page.goto(B + '/assets?q=P-0001');
const seesPress = (await page.locator('tbody a:has-text("P-0001")').count()) === 1;
await page.goto(B + '/assets?q=M-000');
const techNums = await page.locator('tbody tr td:first-child a').allTextContents();
check('site-scoped technician sees only Pune + store assets (incl. form-created M-0008)', seesPress && JSON.stringify(techNums) === JSON.stringify(['M-0001', 'M-0002', 'M-0003', 'M-0007', 'M-0008']), techNums.join(','));
const r404 = await page.goto(B + `/assets/${id('M-0006')}`);
check('technician cannot open a Chennai asset (404)', r404.status() === 404);
const token = q(`select "qrToken" from "Asset" where number='M-0001'`);
await page.goto(B + `/a/${token}`); await page.waitForURL(/tab=counter/);
check('QR link resolves to the shot-counter page', page.url().includes(`/assets/${m1}?tab=counter`));
await page.fill('[name=value]', '4,13,500'); await page.click('button:has-text("Save reading")'); await page.waitForURL(/ok=|error=/);
check('reading saved and lifetime updated', (await flash(page)).includes('Reading saved') && q(`select "lifetimeTotal" from "Meter" m join "Asset" a on a.id=m."assetId" where a.number='M-0001'`) === '413500', await flash(page));
await page.fill('[name=value]', '1000'); await page.click('button:has-text("Save reading")'); await page.waitForURL(/error=/);
check('lower reading rejected without reset', (await flash(page)).includes('lower than the last one'));
await page.fill('[name=value]', '1000'); await page.locator('summary:has-text("reset")').click(); await page.check('[name=isReset]'); await page.fill('[name=resetReason]', 'Counter replaced');
await page.click('button:has-text("Save reading")'); await page.waitForURL(/ok=/);
check('reset with reason keeps lifetime continuous (413,500 + 1,000)', q(`select "lifetimeTotal" from "Meter" m join "Asset" a on a.id=m."assetId" where a.number='M-0001'`) === '414500');
await page.fill('[name=value]', '9000000'); await page.click('button:has-text("Save reading")'); await page.waitForURL(/error=/);
const impl = await flash(page);
check('implausible jump requires confirmation', impl.includes('more than this mold can run') && (await page.locator('[name=confirmHigh]').count()) === 1);
await page.screenshot({ path: SH + '/pm-counter.png', fullPage: true });
const techAdmin = await page.goto(B + '/admin/users'); await page.waitForLoadState('networkidle');
check('technician cannot open user admin', page.url().includes('forbidden'));

// ── Supplier (acceptance 7)
await loginAs(page, 'supplier@brightway.example');
await page.goto(B + '/assets?q=M-000');
const supNums = await page.locator('tbody tr td:first-child a').allTextContents();
check('supplier sees only molds in Brightway custody', JSON.stringify(supNums) === JSON.stringify(['M-0004', 'M-0005']), supNums.join(','));
check('supplier navigation is simplified', (await page.locator('aside a[href^="/admin"]').count()) === 0 && (await page.locator('aside a[href="/import-export"]').count()) === 0);
for (const p of ['/admin/users', '/admin/sites', '/import-export', '/admin/audit']) { await page.goto(B + p); await page.waitForLoadState('networkidle'); if (!page.url().includes('forbidden')) check(`supplier blocked from ${p}`, false, page.url()); }
check('supplier blocked from admin and import screens', true);
const sup404 = await page.goto(B + `/assets/${m1}`);
check('supplier cannot open an asset outside their custody (404)', sup404.status() === 404);
const supDoc = await page.request.get(B + vlink);
check('supplier cannot download another asset\'s document', supDoc.status() === 404);
await page.goto(B + `/assets/${id('M-0005')}?tab=counter`);
await page.fill('[name=value]', '2,851,000'.replace(/,/g, '')); await page.click('button:has-text("Save reading")'); await page.waitForURL(/ok=|error=/);
check('supplier records a reading on a mold in custody', (await flash(page)).includes('Reading saved'), await flash(page));
await page.screenshot({ path: SH + '/pm-supplier.png', fullPage: true });

// ── Audit immutability
let blocked = false;
try { q(`update "AuditEvent" set action='tampered' where id=(select id from "AuditEvent" limit 1)`); } catch { blocked = true; }
let blockedDel = false;
try { q(`delete from "AuditEvent" where id=(select id from "AuditEvent" limit 1)`); } catch { blockedDel = true; }
check('audit rows cannot be updated or deleted at the database level', blocked && blockedDel);
check('audit captured reading, reset and import events', +q(`select count(*) from "AuditEvent" where action in ('reading_recorded','counter_reset')`) >= 3 && +q(`select count(*) from "AuditEvent" where reason like 'CSV import%'`) === 1000);

out('\nbrowser errors:', errors);
out(`\n${results.filter(r => r[1]).length}/${results.length} checks passed`);
await browser.close();
