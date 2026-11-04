import type { Edge, StepInstance, Workflow } from '@onesaas/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import type { EngineEvent } from '../src/engine/events.js';
import type { Executor } from '../src/steps/registry.js';

const WRITE_CONFIG = { instructions: 'Write a reply.', tone: 'friendly' };

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

function mkWorkflow(opts: {
  id?: string;
  trigger?: StepInstance;
  steps?: StepInstance[];
  edges?: Edge[];
}): Workflow {
  return {
    id: opts.id ?? 'wf1',
    name: 'Test workflow',
    description: 'retry test workflow',
    version: 1,
    status: 'on',
    trigger: opts.trigger ?? mkStep('trigger', 'trigger.manual'),
    steps: opts.steps ?? [],
    edges: opts.edges ?? [],
  };
}

function setup() {
  const repo = createRepo(openDb(':memory:'));
  const ctxBase = { gateway: {} as any, tables: {} as any, bridge: {} as any };
  return { repo, ctxBase };
}

function echoExecutor(calls: string[], name: string): Executor {
  return async (_config, input) => {
    calls.push(name);
    return { output: input, why: 'Started manually.' };
  };
}

// trigger→write→draft→log. The draft executor fails until `failFlip.fail` is
// cleared, and records every input so the test can prove the retry re-ran
// with the same input.
function retryFlowExecutors(
  calls: string[],
  draftInputs: unknown[],
  failFlip: { fail: boolean },
): Record<string, Executor> {
  return {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.write': async (_config, input) => {
      calls.push('write');
      expect(input).toEqual({ context: { payload: 1 } });
      return { output: { text: 'Hello there' }, why: 'Wrote a reply.' };
    },
    'gmail.draftReply': (async (_config, input) => {
      calls.push('draft');
      draftInputs.push(input);
      if (failFlip.fail) throw new Error('I need Gmail open in Chrome to do this.');
      return { output: { drafted: true }, why: 'Drafted the reply.' };
    }) as Executor,
    'table.upsert': (async (_config, input) => {
      calls.push('log');
      expect(input).toEqual({ row: { drafted: true } });
      return { output: { id: 1, created: true }, why: 'Logged it.' };
    }) as Executor,
  };
}

function saveRetryFlow(repo: Repo): void {
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('write', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } }),
        mkStep('draft', 'gmail.draftReply', { inputs: { threadId: 't1', body: '{{write.text}}' } }),
        mkStep('log', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{draft}}' },
        }),
      ],
      edges: [
        { from: 'trigger', to: 'write' },
        { from: 'write', to: 'draft' },
        { from: 'draft', to: 'log' },
      ],
    }),
  );
}

test('retry re-runs a failed draft with the same input; downstream runs and the run completes', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const draftInputs: unknown[] = [];
  const failFlip = { fail: true };
  const engine = createEngine({ repo, executors: retryFlowExecutors(calls, draftInputs, failFlip), ctx: ctxBase });
  const events: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => events.push(e));
  saveRetryFlow(repo);

  const failed = await engine.start('wf1', { payload: 1 });
  expect(failed.status).toBe('failed');
  expect(calls).toEqual(['trigger', 'write', 'draft']);
  expect(draftInputs).toEqual([{ threadId: 't1', body: 'Hello there' }]);
  const before = repo.getRun(failed.id)!;
  expect(before.steps.find((s) => s.stepId === 'draft')!.status).toBe('failed');
  expect(before.steps.find((s) => s.stepId === 'log')!.status).toBe('pending');

  failFlip.fail = false;
  const run = await engine.retryStep(failed.id, 'draft');

  expect(run.status).toBe('done');
  expect(run.endedAt).toBeTruthy();
  expect(calls).toEqual(['trigger', 'write', 'draft', 'draft', 'log']);
  // Same input on the retry: re-resolved from the saved write output.
  expect(draftInputs).toHaveLength(2);
  expect(draftInputs[1]).toEqual(draftInputs[0]);
  const after = repo.getRun(run.id)!;
  const byId = new Map(after.steps.map((s) => [s.stepId, s]));
  expect(byId.get('draft')!.status).toBe('done');
  expect(byId.get('draft')!.output).toEqual({ drafted: true });
  expect(byId.get('log')!.status).toBe('done');
  expect(byId.get('write')!.status).toBe('done');
  // The reset emits pending, then the pass runs the step to done.
  const draftStates = events
    .filter((e): e is Extract<EngineEvent, { type: 'step' }> => e.type === 'step' && e.stepRun.stepId === 'draft')
    .map((e) => e.stepRun.status);
  expect(draftStates).toEqual(['pending', 'running', 'failed', 'pending', 'running', 'done']);
  const runSeq = events
    .filter((e): e is Extract<EngineEvent, { type: 'run' }> => e.type === 'run')
    .map((e) => e.run.status);
  expect(runSeq).toEqual(['running', 'failed', 'running', 'done']);
});

test('retryStep on a step that is not failed rejects with the exact error', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const draftInputs: unknown[] = [];
  const engine = createEngine({
    repo,
    executors: retryFlowExecutors(calls, draftInputs, { fail: true }),
    ctx: ctxBase,
  });
  saveRetryFlow(repo);

  const failed = await engine.start('wf1', { payload: 1 });
  expect(failed.status).toBe('failed');
  const MSG = 'Only a step that needs a look can be retried.';
  // Done step (plan case), pending downstream, unknown step and unknown run.
  await expect(engine.retryStep(failed.id, 'write')).rejects.toThrow(MSG);
  await expect(engine.retryStep(failed.id, 'log')).rejects.toThrow(MSG);
  await expect(engine.retryStep(failed.id, 'nope')).rejects.toThrow(MSG);
  await expect(engine.retryStep('no-such-run', 'draft')).rejects.toThrow(MSG);
});

test('retry of a v1 run uses the pinned v1 definition after v2 is saved', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const draftInputs: unknown[] = [];
  const failFlip = { fail: true };
  const engine = createEngine({ repo, executors: retryFlowExecutors(calls, draftInputs, failFlip), ctx: ctxBase });
  saveRetryFlow(repo);

  const failed = await engine.start('wf1', { payload: 1 });
  expect(failed.status).toBe('failed');
  expect(failed.workflowVersion).toBe(1);

  // Bump to v2: title change on write (the plan's trigger) plus a behavioral
  // change on draft's inputs, so the retry provably runs v1's definition.
  const v1 = repo.getWorkflow('wf1', 1)!;
  const v2 = repo.saveWorkflow({
    ...v1,
    version: 2,
    steps: v1.steps.map((s) =>
      s.id === 'write'
        ? { ...s, title: 'Write reply v2' }
        : s.id === 'draft'
          ? { ...s, inputs: { threadId: 't1', body: 'v2 says hi' } }
          : s,
    ),
  });
  expect(v2.version).toBe(2);
  expect(repo.getWorkflow('wf1')!.version).toBe(2);

  failFlip.fail = false;
  const run = await engine.retryStep(failed.id, 'draft');

  expect(run.status).toBe('done');
  expect(run.workflowVersion).toBe(1);
  // v1's body template re-resolved from the saved write output — not v2's literal.
  expect(draftInputs[1]).toEqual({ threadId: 't1', body: 'Hello there' });
});

test('a retry that fails again leaves the run failed with the new error', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const draftInputs: unknown[] = [];
  const engine = createEngine({
    repo,
    executors: retryFlowExecutors(calls, draftInputs, { fail: true }),
    ctx: ctxBase,
  });
  saveRetryFlow(repo);

  const failed = await engine.start('wf1', { payload: 1 });
  const run = await engine.retryStep(failed.id, 'draft');

  expect(run.status).toBe('failed');
  expect(draftInputs).toHaveLength(2);
  const byId = new Map(repo.getRun(run.id)!.steps.map((s) => [s.stepId, s]));
  expect(byId.get('draft')!.status).toBe('failed');
  expect(byId.get('draft')!.error).toBe('I need Gmail open in Chrome to do this.');
  expect(byId.get('log')!.status).toBe('pending');
});
