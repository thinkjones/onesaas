import { expect, test } from '@playwright/test';

const SAMPLE_PREFIX = 'Tested with a sample email because none was open in Gmail.';
const DRAFT_WHY = 'In a real run I would put this reply into Gmail as a draft.';

interface TestRunResponse {
  run: { id: string; kind: string };
  steps: { stepId: string; status: string; why?: string }[];
  usedSample: boolean;
  story: string[];
}

test('flow-1 test run previews everything without touching Gmail', async ({ request }) => {
  // No bridge is connected in E2E, so the run must fall back to the sample.
  const res = await request.post('/api/workflows/flow-1/test');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as TestRunResponse;

  expect(body.usedSample).toBe(true);
  expect(body.run.kind).toBe('test');
  expect(body.steps.length).toBeGreaterThan(0);
  for (const step of body.steps) expect(step.status).toBe('done');
  expect(body.story[0]).toBe(SAMPLE_PREFIX);
  expect(body.steps.map((s) => s.why)).toContain(DRAFT_WHY);

  // The sample notice survives a refetch of the run detail.
  const detail = await request.get(`/api/runs/${body.run.id}`);
  expect(detail.ok()).toBe(true);
  const detailBody = (await detail.json()) as { story: string[] };
  expect(detailBody.story[0]).toBe(SAMPLE_PREFIX);
});

test('try-it button shows the test results strip', async ({ page }) => {
  // The run executes ai.* steps for real (~12s): both timeouts raised.
  test.setTimeout(90_000);
  await page.goto('/automations/flow-1?mode=design');
  await page.getByRole('button', { name: 'Try it' }).click();
  // The strip is an unlabelled div (no landmark role in Chromium's a11y
  // tree), so assert its content: the sample notice plus a per-step why.
  await expect(page.getByText(SAMPLE_PREFIX)).toBeVisible({ timeout: 60_000 });
  // The draft why renders twice: once in the story strip, once under the
  // draft box on the canvas.
  await expect(page.getByText(DRAFT_WHY)).toHaveCount(2);
});
