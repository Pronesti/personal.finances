import { test, expect, type Page } from '@playwright/test';
import { resetSyntheticRateLimits } from './target';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let accounts: Record<string, string>;
test.beforeAll(() => { accounts = JSON.parse(execFileSync('php', ['artisan', 'tarjetas:acceptance:document-users', '--env=browser-testing'], { cwd: fileURLToPath(new URL('../../backend/', import.meta.url)), encoding: 'utf8' })); });
test.beforeEach(resetSyntheticRateLimits);
const api = process.env.TARJETAS_BROWSER_API_ORIGIN ?? 'https://api.tarjetas-browser.test';
const origin = 'https://app.tarjetas-browser.test';
const password = 'Synthetic-Acceptance-Only-2026!';
const aHash = '37dd69eea28907eff1d71466315fc19343d01eec62cbd5f81ed6b61ce8be083d';
const bHash = '61062c81b30c1da1a31eadd99c832e90aec72f63d6b5dc20c76f1e3819aa1623';
async function signIn(page: Page, who = 'a') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(accounts[who]);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private ledger', exact: true })).toBeVisible();
}

test('direct health, cookies, real cross-subdomain CSRF, reload and logout', async ({ page, context }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const health = page.waitForResponse(response => response.url() === `${api}/api/v1/health`);
  await page.goto('/login');
  expect((await health).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText('● API connected');
  const noToken = await page.evaluate(async api => {
    await fetch(`${api}/sanctum/csrf-cookie`, { credentials: 'include', headers: { Accept: 'application/json' } });
    return (await fetch(`${api}/api/v1/auth/login`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'synthetic-a@example.invalid', password: 'wrong' }) })).status;
  }, api);
  expect(noToken).toBe(419);
  const before = (await context.cookies()).find(cookie => cookie.name === 'tarjetas_browser_session')?.value;
  await signIn(page);
  const cookies = await context.cookies();
  const session = cookies.find(cookie => cookie.name === 'tarjetas_browser_session')!;
  expect(session.value).not.toBe(before);
  expect(session).toMatchObject({ domain: '.tarjetas-browser.test', httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(cookies.find(cookie => cookie.name === 'XSRF-TOKEN')).toMatchObject({ domain: '.tarjetas-browser.test', httpOnly: false, secure: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Private ledger', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const status = await page.evaluate(async api => (await fetch(`${api}/api/v1/auth/user`, { credentials: 'include', headers: { Accept: 'application/json' } })).status, api);
  expect(status).toBe(401);
  expect(failures).toEqual([]);
});

test('owner documents, forged owner rejection and credentialed PDF button', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounting/documents');
  await expect(page.getByText('a-only-pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('b-only-pdf', { exact: true })).toHaveCount(0);
  const results = await page.evaluate(async ({ api, bHash }) => {
    const fetchJson = (path: string) => fetch(api + path, { credentials: 'include', headers: { Accept: 'application/json' } });
    return { other: (await fetchJson('/api/v1/documents/' + bHash)).status, forged: (await fetchJson('/api/v1/bootstrap?ledger_id=22222222-2222-4222-8222-222222222222')).status };
  }, { api, bHash });
  expect(results).toEqual({ other: 404, forged: 400 });
  const doc = page.waitForResponse(response => response.url().endsWith(`/documents/${aHash}`));
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Original PDF' }).first().click();
  const response = await doc;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain('blob:https://app.tarjetas-browser.test/');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await signIn(page, 'b');
  await page.goto('/accounting/documents');
  await expect(page.getByText('b-only-pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('a-only-pdf', { exact: true })).toHaveCount(0);
});

test('popup blocked fallback and retained bilingual form on failed login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(accounts.a);
  await page.getByRole('button', { name: 'Cambiar a español' }).click();
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(accounts.a);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private ledger', exact: true })).toBeVisible();
  await page.goto('/accounting/documents');
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Original PDF' }).first().click();
  await expect(page.getByRole('link', { name: 'Open / download' })).toHaveAttribute('href', /^blob:/);
});

test('preflight is public and never grants an untrusted origin', async ({ request }) => {
  const response = await request.fetch(`${api}/api/v1/auth/login`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-xsrf-token,idempotency-key' } });
  expect(response.status()).toBe(204);
  expect(response.headers()['access-control-allow-origin']).toBe(origin);
  expect(response.headers()['access-control-allow-credentials']).toBe('true');
  const untrusted = await request.get(`${api}/api/v1/health`, { headers: { Origin: 'https://untrusted.test' } });
  expect(untrusted.headers()['access-control-allow-origin']).not.toBe('https://untrusted.test');
});

test('native accounting empty state, deep link, language and responsive appearance', async ({ page }) => {
  await signIn(page, 'b');
  await page.goto('/accounting');
  await expect(page.getByRole('heading', { name: 'Accounts and financial history' })).toBeVisible();
  await expect(page.getByText('No financial entries have been posted yet.')).toBeVisible();
  for (const width of [390,1280,1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light','dark'] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.getByRole('button', { name: 'Cambiar a español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.goto('/accounting/evidence/missing-source');
  await expect(page.getByRole('alert')).toHaveText('Evidencia no disponible.');
});
