import { expect, test } from '@playwright/test';

test('helper panel renders input, send and voice placeholder', async ({ page }) => {
  await page.goto('/reducers/flow-1?mode=design');
  const panel = page.getByRole('region', { name: 'Helper' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Message the helper' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
  const mic = panel.getByRole('button', { name: 'Voice coming soon' });
  await expect(mic).toBeVisible();
  await expect(mic).toBeDisabled();
});

test('helper panel collapses and reopens', async ({ page }) => {
  await page.goto('/reducers/flow-1?mode=design');
  await page.getByRole('button', { name: 'Hide helper' }).click();
  await expect(page.getByRole('region', { name: 'Helper' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show helper' }).click();
  await expect(page.getByRole('region', { name: 'Helper' })).toBeVisible();
});

test('sending runs a live turn and shows the reply', async ({ page }) => {
  // MODEL_API_KEY is required (see global setup): this runs one real turn.
  // Assertions stay content-agnostic — the model may say or ask anything.
  test.setTimeout(180_000);
  await page.goto('/reducers/flow-1?mode=design');
  const panel = page.getByRole('region', { name: 'Helper' });
  const input = panel.getByRole('textbox', { name: 'Message the helper' });
  await input.fill('Hello, helper');
  await panel.getByRole('button', { name: 'Send' }).click();

  // Busy while the turn runs.
  await expect(input).toBeDisabled();

  // Turn ends: input back, Dad's row plus at least one agent row. (The
  // conversation div carries no landmark role in Chromium's a11y tree, so
  // scope message assertions to the panel, not a Conversation region.)
  await expect(input).toBeEnabled({ timeout: 150_000 });
  await expect(panel.getByText('Hello, helper')).toBeVisible();
  expect(await panel.locator('p').count()).toBeGreaterThanOrEqual(2);
});
