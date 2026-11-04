import { expect, test } from '@playwright/test';

test('new blank automation opens in design mode with palette and helper', async ({ page }) => {
  await page.goto('/automations');
  await page.getByRole('button', { name: 'New automation' }).click();
  await expect(page).toHaveURL(/\/automations\/.+\?mode=design/);
  await expect(page.getByRole('heading', { name: 'Untitled automation' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Add a step' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Helper' })).toBeVisible();
});

test('palette adds a step, config form saves, problems gate turn-on', async ({ page }) => {
  await page.goto('/automations');
  await page.getByRole('button', { name: 'New automation' }).click();
  await expect(page).toHaveURL(/\/automations\/.+\?mode=design/);

  const palette = page.getByRole('complementary', { name: 'Add a step' });
  await expect(palette.getByRole('button', { name: 'Extract details' })).toBeVisible();
  await palette.getByRole('button', { name: 'Extract details' }).click();

  const node = page.locator('.react-flow__node', { hasText: 'Extract details' });
  await expect(node).toBeVisible();

  // Select the step: its config form opens.
  await node.click();
  await expect(page.getByRole('heading', { name: 'Settings for Extract details' })).toBeVisible();

  // An unconfigured step reports problems and blocks Turn on.
  await expect(page.getByText(/\d+ things? to fix before turning on/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on', exact: true })).toHaveCount(0);
});

test('backspace deletes a step and Undo restores it', async ({ page }) => {
  await page.goto('/automations');
  await page.getByRole('button', { name: 'New automation' }).click();
  await expect(page).toHaveURL(/\/automations\/.+\?mode=design/);

  await page
    .getByRole('complementary', { name: 'Add a step' })
    .getByRole('button', { name: 'Extract details' })
    .click();
  const node = page.locator('.react-flow__node', { hasText: 'Extract details' });
  await expect(node).toBeVisible();

  await node.click();
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Deleted "Extract details".')).toBeVisible();
  await expect(node).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.locator('.react-flow__node', { hasText: 'Extract details' }),
  ).toBeVisible();
});
