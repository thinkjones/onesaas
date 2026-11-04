import { expect, test } from '@playwright/test';
import { API_BASE } from '../env.js';

test('API health is reachable directly and through the web proxy', async ({ request }) => {
  const direct = await request.get(`${API_BASE}/health`);
  expect(direct.ok()).toBe(true);
  expect(await direct.json()).toMatchObject({ ok: true });

  // /health is API-root-only; exercise the Vite proxy with a real /api route.
  const proxied = await request.get('/api/workflows');
  expect(proxied.ok()).toBe(true);
  expect(await proxied.json()).toBeInstanceOf(Array);
});

test('automate shows the one-sentence start box', async ({ page }) => {
  await page.goto('/automate');
  await expect(
    page.getByRole('heading', { name: 'What chore should I take off your hands?' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build it' })).toBeVisible();
});

test('settings issues a 6-digit pairing code', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect Chrome' }).click();
  await expect(page.getByText(/^\d{6}$/)).toBeVisible();
});

test('reducers list shows the seeded flow-1 workflow', async ({ page }) => {
  await page.goto('/reducers');
  await expect(page.getByRole('heading', { name: 'Chore reducers' })).toBeVisible();
  await expect(page.getByText('Save as lead & reply')).toBeVisible();
});
