import type { Edge, Run, StepInstance, StepRun, Workflow } from '@dad/shared';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import { executors as realExecutors } from '../src/steps/registry.js';
import type { Executor } from '../src/steps/registry.js';

const WRITE_CONFIG = { instructions: 'Write a reply.', tone: 'friendly' };
const TRIGGER_SUMMARY = 'Runs when you click the button in Gmail.';

function mkStep(
  id: string,
  type: string,
  opts?: { config?: Record<string, unknown>; inputs?: Record<string, string> },
): StepInstance {
  return {
    id,
    type,
    title: id,
    summary: `${id} step`,
    config: opts?.config ?? {},
    inputs: opts?.inputs ?? {},
    position: { x: 0, y: 0 },
  };
}

function mkWorkflow(id: string, steps: StepInstance[], edges: Edge[]): Workflow {
  return {
    id,
    name: 'Test workflow',
    description: 'routes test workflow',
    version: 1,
    status: 'on',
    trigger: {
      ...mkStep('trigger', 'trigger.manual'),
      title: 'Gmail button',
      summary: TRIGGER_SUMMARY,
    },
    steps,
    edges,
  };
}

interface Setup {
  app: ReturnType<typeof createApp>;
  repo: Repo;
  engine: ReturnType<typeof createEngine>;
  seen: { draftInput?: unknown };
  failFlip: { fail: boolean };
}

// Real app + real engine + sqlite repo; only step implementations are faked
// (Task 1's neighbor style), with the real approval.ask executor.
function setup(): Setup {
  const repo = createRepo(openDb(':memory:'));
  const seen: { draftInput?: unknown } = {};
  const failFlip = { fail: true };
  const executors: Record<string, Executor> = {
    'trigger.manual': (async (_config, input) => ({ output: input, why: 'Started manually.' })) as Executor,
    'ai.write': (async () => ({ output: { text: 'Hello there' }, why: 'Wrote a reply.' })) as Executor,
    'approval.ask': realExecutors['approval.ask']!,
    'gmail.draftReply': (async (_config, input) => {
      seen.draftInput = input;
      if (failFlip.fail) throw new Error('I need Gmail open in Chrome to do this.');
      return { output: { drafted: true }, why: 'Drafted the reply.' };
    }) as Executor,
    'table.upsert': (async () => ({ output: { id: 1, created: true }, why: 'Logged it.' })) as Executor,
  };
  const engine = createEngine({
    repo,
    executors,
    ctx: { gateway: {} as any, tables: {} as any, bridge: {} as any },
  });
  repo.saveWorkflow(
    mkWorkflow(
      'wf-approve',
      [
        mkStep('write', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } }),
        mkStep('approve', 'approval.ask', { inputs: { text: '{{write.text}}' } }),
        mkStep('draft', 'gmail.draftReply', { inputs: { threadId: 't1', body: '{{approve.text}}' } }),
      ],
      [
        { from: 'trigger', to: 'write' },
        { from: 'write', to: 'approve' },
        { from: 'approve', to: 'draft' },
      ],
    ),
  );
  repo.saveWorkflow(
    mkWorkflow(
      'wf-retry',
      [
        mkStep('write', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } }),
        mkStep('draft', 'gmail.draftReply', { inputs: { threadId: 't1', body: '{{write.text}}' } }),
        mkStep('log', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{draft}}' },
        }),
      ],
      [
        { from: 'trigger', to: 'write' },
        { from: 'write', to: 'draft' },
        { from: 'draft', to: 'log' },
      ],
    ),
  );
  const app = createApp({ repo, engine });
  return { app, repo, engine, seen, failFlip };
}

async function waitingApprovalRun(s: Setup): Promise<Run> {
  s.failFlip.fail = false;
  return s.engine.start('wf-approve', { payload: 1 });
}

async function failedRetryRun(s: Setup): Promise<Run> {
  s.failFlip.fail = true;
  return s.engine.start('wf-retry', { payload: 1 });
}

async function postJson(app: ReturnType<typeof createApp>, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('GET /api/runs/:id returns run, steps, story and the run’s own workflow version', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);
  expect(started.status).toBe('waiting');

  const res = await s.app.request(`/api/runs/${started.id}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { run: Run; steps: StepRun[]; story: string[]; workflow: Workflow };
  expect(Object.keys(body).sort()).toEqual(['run', 'steps', 'story', 'workflow']);
  expect(body.run.id).toBe(started.id);
  expect(body.steps.find((x) => x.stepId === 'approve')!.status).toBe('waiting');
  expect(body.workflow.id).toBe('wf-approve');
  expect(body.workflow.version).toBe(1);
  expect(body.story[0]!.startsWith(TRIGGER_SUMMARY)).toBe(true);
  expect(body.story[body.story.length - 1]).toBe('Waiting for you to check "approve".');

  // After v2 is saved, the old run still reports its own v1 definition.
  const v1 = s.repo.getWorkflow('wf-approve', 1)!;
  const v2 = s.repo.saveWorkflow({
    ...v1,
    version: 2,
    steps: v1.steps.map((x) => (x.id === 'write' ? { ...x, title: 'Write reply v2' } : x)),
  });
  expect(v2.version).toBe(2);
  const again = await s.app.request(`/api/runs/${started.id}`);
  expect(again.status).toBe(200);
  const againBody = (await again.json()) as { run: Run; workflow: Workflow };
  expect(againBody.run.workflowVersion).toBe(1);
  expect(againBody.workflow.version).toBe(1);
});

test('POST approval with approve completes the run and returns run, steps, story', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);

  const res = await postJson(s.app, `/api/runs/${started.id}/steps/approve/approval`, { action: 'approve' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { run: Run; steps: StepRun[]; story: string[] };
  expect(Object.keys(body).sort()).toEqual(['run', 'steps', 'story']);
  expect(body.run.status).toBe('done');
  expect(body.steps.find((x) => x.stepId === 'approve')!.status).toBe('done');
  expect(body.steps.find((x) => x.stepId === 'draft')!.status).toBe('done');
  expect(s.seen.draftInput).toEqual({ threadId: 't1', body: 'Hello there' });
  expect(body.story[0]!.startsWith(TRIGGER_SUMMARY)).toBe(true);
});

test('POST approval with edit passes the edited text to the draft', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);

  const res = await postJson(s.app, `/api/runs/${started.id}/steps/approve/approval`, {
    action: 'edit',
    text: 'Hi Sarah!',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { run: Run };
  expect(body.run.status).toBe('done');
  expect(s.seen.draftInput).toEqual({ threadId: 't1', body: 'Hi Sarah!' });
});

test('POST approval on an unknown run or step is a 404', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);

  const noRun = await postJson(s.app, '/api/runs/does-not-exist/steps/approve/approval', { action: 'approve' });
  expect(noRun.status).toBe(404);
  expect(await noRun.json()).toEqual({ error: 'Unknown run: does-not-exist' });

  const noStep = await postJson(s.app, `/api/runs/${started.id}/steps/nope/approval`, { action: 'approve' });
  expect(noStep.status).toBe(404);
  expect(await noStep.json()).toEqual({ error: 'Unknown step: nope' });
});

test('a second approval on the same step is a 409', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);

  const first = await postJson(s.app, `/api/runs/${started.id}/steps/approve/approval`, { action: 'approve' });
  expect(first.status).toBe(200);
  const second = await postJson(s.app, `/api/runs/${started.id}/steps/approve/approval`, { action: 'approve' });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "That step isn't waiting for you." });
});

test('POST approval with an invalid body is a 400', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);
  const url = `/api/runs/${started.id}/steps/approve/approval`;

  for (const bad of [
    { action: 'bogus' },
    {},
    { action: 'edit' },
    { action: 'edit', text: 42 },
    { action: 'approve', text: 'surplus' },
  ]) {
    const res = await postJson(s.app, url, bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid approval body' });
  }
  // The run is untouched and still waiting.
  expect(s.repo.getRun(started.id)!.run.status).toBe('waiting');

  const empty = await s.app.request(url, { method: 'POST' });
  expect(empty.status).toBe(400);
});

test('POST approval with empty edit text is a 422', async () => {
  const s = setup();
  const started = await waitingApprovalRun(s);
  const url = `/api/runs/${started.id}/steps/approve/approval`;

  for (const text of ['', '   ']) {
    const res = await postJson(s.app, url, { action: 'edit', text });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'The reply is empty' });
  }
  expect(s.repo.getRun(started.id)!.run.status).toBe('waiting');
});

test('POST retry reruns the failed step and completes the run', async () => {
  const s = setup();
  const failed = await failedRetryRun(s);
  expect(failed.status).toBe('failed');

  s.failFlip.fail = false;
  const res = await postJson(s.app, `/api/runs/${failed.id}/steps/draft/retry`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { run: Run; steps: StepRun[]; story: string[] };
  expect(Object.keys(body).sort()).toEqual(['run', 'steps', 'story']);
  expect(body.run.status).toBe('done');
  expect(body.steps.find((x) => x.stepId === 'draft')!.status).toBe('done');
  expect(body.steps.find((x) => x.stepId === 'log')!.status).toBe('done');
  expect(body.story[0]!.startsWith(TRIGGER_SUMMARY)).toBe(true);
});

test('POST retry on a step that is not failed is a 409; unknown ids are 404', async () => {
  const s = setup();
  const failed = await failedRetryRun(s);

  const wrongState = await postJson(s.app, `/api/runs/${failed.id}/steps/write/retry`);
  expect(wrongState.status).toBe(409);
  expect(await wrongState.json()).toEqual({ error: 'Only a step that needs a look can be retried.' });

  const noRun = await postJson(s.app, '/api/runs/does-not-exist/steps/draft/retry');
  expect(noRun.status).toBe(404);
  expect(await noRun.json()).toEqual({ error: 'Unknown run: does-not-exist' });

  const noStep = await postJson(s.app, `/api/runs/${failed.id}/steps/nope/retry`);
  expect(noStep.status).toBe(404);
  expect(await noStep.json()).toEqual({ error: 'Unknown step: nope' });
});
