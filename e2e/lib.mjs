// Shared browser helpers for the acceptance suite.
import { chromium } from 'playwright-core';
export const B = process.env.BASE_URL ?? 'http://localhost:3000';
export async function start() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => errors.push(`pageerror at ${page.url()}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/caret-color|hydrated but some attributes/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { browser, ctx, page, errors };
}
export async function login(page, email, pw = 'Demo@12345') {
  await page.goto(B + '/login');
  await page.fill('[name=email]', email); await page.fill('[name=password]', pw);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(async () => console.log('login flash:', await flash(page)));
}
export async function flash(page) {
  const n = page.locator('.border-red-200, .border-emerald-200');
  await n.first().waitFor({ timeout: 8000 }).catch(() => {});
  return (await n.count()) ? (await n.first().textContent()).trim() : '';
}
