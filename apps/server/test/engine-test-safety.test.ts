import type { StepRun, Workflow } from '@onesaas/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import type { Executor } from '../src/steps/registry.js';

const RETRY_REFUSAL = 'A test run can\'t be retried. Press "Try it" again for a fresh run.';
const APPROVAL_REFUSAL = 'A test run can\'t be approved. Press "Try it" again for a fresh run.';

function manualOnlyWorkflow(): Workflow {
  return {
    id: 'wf1',
    name: 'Test workflow',
    description: 'test workflow',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.manual',
      title: 'Manual trigger',
      summary: 'Runs when you start it by hand.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [],
    edges: [],
  };
}

function setup() {
  const repo = createRepo(openDb(':memory:'));
  repo.saveWorkflow(manualOnlyWorkflow());
  // Fakes ignore ctx entirely, so stub service objects are sufficient.
  const ctxBase = { gateway: {} as never, tables: {} as never, bridge: {} as never };
  return { repo, ctxBase };
}

function craftStepRun(
  repo: Repo,
  runId: string,
  stepId: string,
  patch: Partial<StepRun> & { status: StepRun['status'] },
): void {
  repo.upsertStepRun({
    id: `sr-${runId}-${stepId}`,
    runId,
    stepId,
    startedAt: new Date().toISOString(),
    ...patch,
  });
}

test('resumeAll fails a stranded test run WITHOUT continuing it, while live runs still resume', async () => {
  const { repo, ctxBase } = setup();
  const payload = { payload: { hello: 'world' } };
  const stranded = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'running',
    kind: 'test',
  });
  craftStepRun(repo, stranded.id, 'trigger', { status: 'running', input: payload });
  const live = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'running',
  });
  craftStepRun(repo, live.id, 'trigger', { status: 'running', input: payload });

  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': async (_config, input) => {
      calls.push('trigger.manual');
      return { output: input, why: 'Started manually.' };
    },
  };
  // A fresh engine on the same repo simulates a restart.
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  await engine.resumeAll();

  // The stranded test run is terminal-failed, never re-run.
  const afterTest = repo.getRun(stranded.id)!;
  expect(afterTest.run.status).toBe('failed');
  expect(afterTest.run.endedAt).toBeDefined();
  expect(afterTest.steps.find((s) => s.stepId === 'trigger')!.status).toBe('failed');
  // Only the live run continued through the engine (one trigger execution).
  expect(calls).toEqual(['trigger.manual']);
  const afterLive = repo.getRun(live.id)!;
  expect(afterLive.run.status).toBe('done');
});

test('retryStep refuses a test-run id with a readable error', async () => {
  const { repo, ctxBase } = setup();
  const run = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: { payload: {} },
    status: 'failed',
    kind: 'test',
  });
  craftStepRun(repo, run.id, 'trigger', { status: 'failed', error: 'boom' });

  const engine = createEngine({ repo, executors: {}, ctx: ctxBase });
  await expect(engine.retryStep(run.id, 'trigger')).rejects.toThrow(RETRY_REFUSAL);
  // Refused means untouched: still failed, no retry started.
  expect(repo.getRun(run.id)!.steps.find((s) => s.stepId === 'trigger')!.status).toBe('failed');
});

test('resolveApproval refuses a test-run id with a readable error', async () => {
  const { repo, ctxBase } = setup();
  const run = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: { payload: {} },
    status: 'waiting',
    kind: 'test',
  });
  craftStepRun(repo, run.id, 'trigger', {
    status: 'waiting',
    input: { text: 'hi' },
    output: { proposed: { text: 'hi' } },
  });

  const engine = createEngine({ repo, executors: {}, ctx: ctxBase });
  await expect(engine.resolveApproval(run.id, 'trigger', { action: 'approve' })).rejects.toThrow(
    APPROVAL_REFUSAL,
  );
  expect(repo.getRun(run.id)!.steps.find((s) => s.stepId === 'trigger')!.status).toBe('waiting');
});

test('retryStep on a live run still retries (test refusal changes nothing for live runs)', async () => {
  const { repo, ctxBase } = setup();
  const payload = { payload: { hello: 'world' } };
  const run = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'failed',
  });
  craftStepRun(repo, run.id, 'trigger', { status: 'failed', error: 'boom' });

  const calls: string[] = [];
  const engine = createEngine({
    repo,
    executors: {
      'trigger.manual': async (_config, input) => {
        calls.push('trigger.manual');
        return { output: input, why: 'Started manually.' };
      },
    },
    ctx: ctxBase,
  });
  const retried = await engine.retryStep(run.id, 'trigger');
  expect(retried.status).toBe('done');
  expect(calls).toEqual(['trigger.manual']);
});
