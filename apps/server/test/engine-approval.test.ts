import { randomUUID } from 'node:crypto';
import type { Edge, StepInstance, StepRun, Workflow } from '@dad/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import type { EngineEvent } from '../src/engine/events.js';
import { askExecutor } from '../src/steps/approval.js';
import { executors as realExecutors } from '../src/steps/registry.js';
import type { Executor } from '../src/steps/registry.js';

const WRITE_CONFIG = { instructions: 'Write a reply.', tone: 'friendly' };
const EXTRACT_CONFIG = {
  instructions: 'Read the enquiry.',
  fields: [{ name: 'ok', type: 'boolean', description: 'Whether it is ok' }],
};

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
    description: 'approval test workflow',
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

// trigger→write→approve→draft, the canonical approval flow. Neighbors are
// faked (real types, fake impls); approval.ask is the real executor.
function approvalFlowExecutors(calls: string[], seen: { draftInput?: unknown }): Record<string, Executor> {
  return {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.write': async (_config, input) => {
      calls.push('write');
      expect(input).toEqual({ context: { payload: 1 } });
      return { output: { text: 'Hello there' }, why: 'Wrote.' };
    },
    'approval.ask': realExecutors['approval.ask']!,
    'gmail.draftReply': async (_config, input) => {
      calls.push('draft');
      seen.draftInput = input;
      return { output: { drafted: true }, why: 'Drafted.' };
    },
  };
}

function saveApprovalFlow(repo: Repo): void {
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('write', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } }),
        mkStep('approve', 'approval.ask', { inputs: { text: '{{write.text}}' } }),
        mkStep('draft', 'gmail.draftReply', { inputs: { threadId: 't1', body: '{{approve.text}}' } }),
      ],
      edges: [
        { from: 'trigger', to: 'write' },
        { from: 'write', to: 'approve' },
        { from: 'approve', to: 'draft' },
      ],
    }),
  );
}

test('run pauses at approval: approve waiting, run waiting, draft still pending', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  const events: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => events.push(e));
  saveApprovalFlow(repo);

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('waiting');
  expect(run.endedAt).toBeUndefined();
  expect(calls).toEqual(['trigger', 'write']);
  const full = repo.getRun(run.id)!;
  const byId = new Map(full.steps.map((s) => [s.stepId, s]));
  expect(byId.get('approve')!.status).toBe('waiting');
  expect(byId.get('approve')!.output).toEqual({ proposed: { text: 'Hello there' } });
  expect(byId.get('approve')!.input).toEqual({ text: 'Hello there' });
  expect(byId.get('approve')!.why).toBe('Waiting for you to approve this.');
  expect(byId.get('draft')!.status).toBe('pending');
  expect(seen.draftInput).toBeUndefined();
  const runSeq = events
    .filter((e): e is Extract<EngineEvent, { type: 'run' }> => e.type === 'run')
    .map((e) => e.run.status);
  expect(runSeq).toEqual(['running', 'waiting']);
  const approveStates = events
    .filter(
      (e): e is Extract<EngineEvent, { type: 'step' }> =>
        e.type === 'step' && e.stepRun.stepId === 'approve',
    )
    .map((e) => e.stepRun.status);
  expect(approveStates).toEqual(['pending', 'running', 'waiting']);
});

test('edit resolution continues the run and draft receives the edited text', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  saveApprovalFlow(repo);

  const started = await engine.start('wf1', { payload: 1 });
  expect(started.status).toBe('waiting');
  const run = await engine.resolveApproval(started.id, 'approve', {
    action: 'edit',
    text: 'Hi Sarah!',
  });

  expect(run.status).toBe('done');
  expect(seen.draftInput).toEqual({ threadId: 't1', body: 'Hi Sarah!' });
  const byId = new Map(repo.getRun(run.id)!.steps.map((s) => [s.stepId, s]));
  expect(byId.get('approve')!.status).toBe('done');
  expect(byId.get('approve')!.output).toEqual({ text: 'Hi Sarah!', decision: 'edited' });
  expect(byId.get('approve')!.why).toMatch(
    /^You changed the wording and approved it at \d{1,2}:\d{2} [AP]M\.$/,
  );
  expect(byId.get('draft')!.status).toBe('done');
});

test('approve resolution uses the proposed text with decision approved', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  saveApprovalFlow(repo);

  const started = await engine.start('wf1', { payload: 1 });
  const run = await engine.resolveApproval(started.id, 'approve', { action: 'approve' });

  expect(run.status).toBe('done');
  expect(seen.draftInput).toEqual({ threadId: 't1', body: 'Hello there' });
  const byId = new Map(repo.getRun(run.id)!.steps.map((s) => [s.stepId, s]));
  expect(byId.get('approve')!.status).toBe('done');
  expect(byId.get('approve')!.output).toEqual({ text: 'Hello there', decision: 'approved' });
  expect(byId.get('approve')!.why).toMatch(/^You approved this at \d{1,2}:\d{2} [AP]M\.$/);
});

test('skip resolution skips the step and propagates downstream', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  saveApprovalFlow(repo);

  const started = await engine.start('wf1', { payload: 1 });
  const run = await engine.resolveApproval(started.id, 'approve', { action: 'skip' });

  expect(run.status).toBe('done');
  expect(calls).not.toContain('draft');
  const byId = new Map(repo.getRun(run.id)!.steps.map((s) => [s.stepId, s]));
  expect(byId.get('approve')!.status).toBe('skipped');
  expect(byId.get('approve')!.why).toBe('You chose to skip this.');
  // The provisional output is left untouched for audit.
  expect(byId.get('approve')!.output).toEqual({ proposed: { text: 'Hello there' } });
  expect(byId.get('draft')!.status).toBe('skipped');
  expect(byId.get('draft')!.why).toBe('Skipped because an earlier step was skipped.');
});

test('resolving a step that is not waiting rejects with the exact error', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  saveApprovalFlow(repo);

  const started = await engine.start('wf1', { payload: 1 });
  await expect(engine.resolveApproval(started.id, 'draft', { action: 'approve' })).rejects.toThrow(
    "That step isn't waiting for you.",
  );
  await expect(engine.resolveApproval(started.id, 'write', { action: 'approve' })).rejects.toThrow(
    "That step isn't waiting for you.",
  );
  await expect(engine.resolveApproval(started.id, 'nope', { action: 'approve' })).rejects.toThrow(
    "That step isn't waiting for you.",
  );
});

test('double resolve rejects: the second resolve sees a done step', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  saveApprovalFlow(repo);

  const started = await engine.start('wf1', { payload: 1 });
  await engine.resolveApproval(started.id, 'approve', { action: 'approve' });
  await expect(
    engine.resolveApproval(started.id, 'approve', { action: 'approve' }),
  ).rejects.toThrow("That step isn't waiting for you.");
});

test('multi-approval flows pause again at the second approval', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const engine = createEngine({
    repo,
    executors: {
      'trigger.manual': echoExecutor(calls, 'trigger'),
      'approval.ask': realExecutors['approval.ask']!,
    },
    ctx: ctxBase,
  });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a1', 'approval.ask', { inputs: { text: 'first' } }),
        mkStep('a2', 'approval.ask', { inputs: { text: '{{a1.text}}' } }),
      ],
      edges: [
        { from: 'trigger', to: 'a1' },
        { from: 'a1', to: 'a2' },
      ],
    }),
  );

  const started = await engine.start('wf1', { payload: 1 });
  expect(started.status).toBe('waiting');
  const mid = await engine.resolveApproval(started.id, 'a1', { action: 'approve' });
  expect(mid.status).toBe('waiting');
  const byIdMid = new Map(repo.getRun(mid.id)!.steps.map((s) => [s.stepId, s]));
  expect(byIdMid.get('a1')!.status).toBe('done');
  expect(byIdMid.get('a2')!.status).toBe('waiting');
  expect(byIdMid.get('a2')!.output).toEqual({ proposed: { text: 'first' } });
  const final = await engine.resolveApproval(mid.id, 'a2', { action: 'edit', text: 'second!' });
  expect(final.status).toBe('done');
  expect(repo.getRun(final.id)!.steps.find((s) => s.stepId === 'a2')!.output).toEqual({
    text: 'second!',
    decision: 'edited',
  });
});

test('askExecutor applies the default question when config omits it', async () => {
  const ctx = { gateway: {}, tables: {}, bridge: {}, signal: new AbortController().signal } as any;
  const result = await askExecutor({}, { text: 'hi' }, ctx);
  expect(result.output).toEqual({ proposed: { text: 'hi' } });
  expect(result.why).toBe('Waiting for you to approve this.');
  expect(result.wait).toEqual({
    kind: 'approval',
    question: 'Is this OK to use?',
    proposed: { text: 'hi' },
  });
});

test('askExecutor uses the configured question when present', async () => {
  const ctx = { gateway: {}, tables: {}, bridge: {}, signal: new AbortController().signal } as any;
  const result = await askExecutor({ question: 'Ship it?' }, { text: 'hi' }, ctx);
  expect(result.wait).toEqual({ kind: 'approval', question: 'Ship it?', proposed: { text: 'hi' } });
});

function craftStepRun(
  repo: Repo,
  runId: string,
  stepId: string,
  patch: Partial<StepRun> & { status: StepRun['status'] },
): void {
  repo.upsertStepRun({
    id: randomUUID(),
    runId,
    stepId,
    startedAt: new Date().toISOString(),
    ...patch,
  });
}

test('resumeAll leaves a waiting run waiting and resolvable after a restart', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const seen: { draftInput?: unknown } = {};
  saveApprovalFlow(repo);
  const payload = { payload: 1 };
  const crafted = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'waiting',
  });
  craftStepRun(repo, crafted.id, 'trigger', { status: 'done', input: payload, output: payload });
  craftStepRun(repo, crafted.id, 'write', {
    status: 'done',
    input: { context: payload },
    output: { text: 'Hello there' },
  });
  craftStepRun(repo, crafted.id, 'approve', {
    status: 'waiting',
    input: { text: 'Hello there' },
    output: { proposed: { text: 'Hello there' } },
    why: 'Waiting for you to approve this.',
  });
  craftStepRun(repo, crafted.id, 'draft', { status: 'pending' });

  // A fresh engine on the same repo simulates a restart.
  const engine = createEngine({ repo, executors: approvalFlowExecutors(calls, seen), ctx: ctxBase });
  await engine.resumeAll();

  const after = repo.getRun(crafted.id)!;
  expect(after.run.status).toBe('waiting');
  expect(after.steps.find((s) => s.stepId === 'approve')!.status).toBe('waiting');
  expect(after.steps.find((s) => s.stepId === 'draft')!.status).toBe('pending');
  const resolved = await engine.resolveApproval(crafted.id, 'approve', { action: 'approve' });
  expect(resolved.status).toBe('done');
  expect(seen.draftInput).toEqual({ threadId: 't1', body: 'Hello there' });
});

test('resumeAll re-runs an interrupted enrich step', async () => {
  const { repo, ctxBase } = setup();
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );
  const payload = { payload: 1 };
  const crafted = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'running',
  });
  craftStepRun(repo, crafted.id, 'trigger', { status: 'done', input: payload, output: payload });
  craftStepRun(repo, crafted.id, 'a', { status: 'running', input: { text: 't' } });

  let aCalls = 0;
  let aInput: unknown;
  const engine = createEngine({
    repo,
    executors: {
      'trigger.manual': echoExecutor([], 'trigger'),
      'ai.extract': (async (_config, input) => {
        aCalls += 1;
        aInput = input;
        return { output: { ok: true }, why: 'Extracted.' };
      }) as Executor,
    },
    ctx: ctxBase,
  });
  await engine.resumeAll();

  expect(aCalls).toBe(1);
  expect(aInput).toEqual({ text: 't' });
  const after = repo.getRun(crafted.id)!;
  expect(after.run.status).toBe('done');
  const a = after.steps.find((s) => s.stepId === 'a')!;
  expect(a.status).toBe('done');
  expect(a.output).toEqual({ ok: true });
});

test('resumeAll fails an interrupted act step without re-running it', async () => {
  const { repo, ctxBase } = setup();
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('d', 'gmail.draftReply', { inputs: { threadId: 't1', body: 'hi' } })],
      edges: [{ from: 'trigger', to: 'd' }],
    }),
  );
  const payload = { payload: 1 };
  const crafted = repo.createRun({
    workflowId: 'wf1',
    workflowVersion: 1,
    triggerPayload: payload,
    status: 'running',
  });
  craftStepRun(repo, crafted.id, 'trigger', { status: 'done', input: payload, output: payload });
  craftStepRun(repo, crafted.id, 'd', {
    status: 'running',
    input: { threadId: 't1', body: 'hi' },
  });

  let dCalls = 0;
  const engine = createEngine({
    repo,
    executors: {
      'trigger.manual': echoExecutor([], 'trigger'),
      'gmail.draftReply': (async () => {
        dCalls += 1;
        return { output: { drafted: true }, why: 'Drafted.' };
      }) as Executor,
    },
    ctx: ctxBase,
  });
  await engine.resumeAll();

  expect(dCalls).toBe(0);
  const after = repo.getRun(crafted.id)!;
  expect(after.run.status).toBe('failed');
  expect(after.run.endedAt).toBeTruthy();
  const d = after.steps.find((s) => s.stepId === 'd')!;
  expect(d.status).toBe('failed');
  expect(d.error).toBe("I was interrupted while doing this. Press Retry if it didn't happen.");
  expect(d.input).toEqual({ threadId: 't1', body: 'hi' });
  expect(d.durationMs).toBeUndefined();
});
