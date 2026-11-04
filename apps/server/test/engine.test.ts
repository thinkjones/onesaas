import type { Edge, StepInstance, Workflow } from '@onesaas/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import type { EngineEvent } from '../src/engine/events.js';
import type { Executor } from '../src/steps/registry.js';

const EXTRACT_CONFIG = {
  instructions: 'Read the enquiry.',
  fields: [{ name: 'ok', type: 'boolean', description: 'Whether it is ok' }],
};

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

function mkWorkflow(opts: { trigger?: StepInstance; steps?: StepInstance[]; edges?: Edge[] }): Workflow {
  return {
    id: 'wf1',
    name: 'Test workflow',
    description: 'engine test workflow',
    version: 1,
    status: 'on',
    trigger: opts.trigger ?? mkStep('trigger', 'trigger.manual'),
    steps: opts.steps ?? [],
    edges: opts.edges ?? [],
  };
}

function setup() {
  const repo = createRepo(openDb(':memory:'));
  // Fakes ignore ctx entirely, so stub service objects are sufficient.
  const ctxBase = { gateway: {} as any, tables: {} as any, bridge: {} as any };
  return { repo, ctxBase };
}

function echoExecutor(calls: string[], name: string): Executor {
  return async (_config, input) => {
    calls.push(name);
    return { output: input, why: 'Started manually.' };
  };
}

test('linear trigger→a→b runs in order with running→done step runs', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.extract': async (_config, input) => {
      calls.push('a');
      expect(input).toEqual({ text: 'hello there' });
      return { output: { ok: true }, why: 'Extracted.' };
    },
    'table.upsert': async (_config, input) => {
      calls.push('b');
      expect(input).toEqual({ row: { ok: true } });
      return { output: { id: 1, created: true }, why: 'Saved.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  const seen: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => seen.push(e));
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 'hello there' } }),
        mkStep('b', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{a}}' },
        }),
      ],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'b' },
      ],
    }),
  );

  const payload = { payload: { note: 'hi' } };
  const run = await engine.start('wf1', payload);

  expect(run.status).toBe('done');
  expect(run.endedAt).toBeTruthy();
  expect(calls).toEqual(['trigger', 'a', 'b']);
  const full = repo.getRun(run.id)!;
  expect(full.steps.map((s) => [s.stepId, s.status])).toEqual([
    ['trigger', 'done'],
    ['a', 'done'],
    ['b', 'done'],
  ]);
  for (const sr of full.steps) {
    expect(sr.input).toBeDefined();
    expect(sr.output).toBeDefined();
    expect(sr.why).toBeTruthy();
    expect(typeof sr.durationMs).toBe('number');
  }
  expect(full.steps[0]!.output).toEqual(payload);
  // Each step went pending → running → done (the running state is visible on events).
  for (const stepId of ['trigger', 'a', 'b']) {
    const states = seen
      .filter((e): e is { type: 'step'; stepRun: { stepId: string; status: string } } & EngineEvent =>
        e.type === 'step' && e.stepRun.stepId === stepId,
      )
      .map((e) => e.stepRun.status);
    expect(states).toEqual(['pending', 'running', 'done']);
  }
});

test('independent branches start concurrently', async () => {
  const { repo, ctxBase } = setup();
  let entered = 0;
  let release!: () => void;
  const bothEntered = new Promise<void>((r) => {
    release = r;
  });
  const latch = async () => {
    entered += 1;
    if (entered === 2) release();
    await bothEntered;
  };
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => {
      await latch();
      return { output: { ok: true }, why: 'x done.' };
    },
    'ai.write': async () => {
      await latch();
      return { output: { text: 'hi' }, why: 'y done.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('x', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } }),
        mkStep('y', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } }),
      ],
      edges: [
        { from: 'trigger', to: 'x' },
        { from: 'trigger', to: 'y' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  expect(entered).toBe(2);
});

test('false when condition skips the target and downstream-only steps', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.extract': async () => {
      calls.push('a');
      return { output: { ok: true }, why: 'Extracted.' };
    },
    'ai.write': async () => {
      calls.push('b');
      return { output: { text: 'unreached' }, why: 'unreached' };
    },
    'table.upsert': async () => {
      calls.push('c');
      return { output: { id: 1, created: true }, why: 'unreached' };
    },
    'gmail.draftReply': async () => {
      calls.push('s');
      return { output: { drafted: true }, why: 'Drafted.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } }),
        mkStep('b', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{a}}' } }),
        mkStep('c', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{b}}' },
        }),
        mkStep('s', 'gmail.draftReply', { inputs: { threadId: 't1', body: 'hi' } }),
      ],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'b', when: 'a.ok == false' },
        { from: 'b', to: 'c' },
        { from: 'trigger', to: 's' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  expect(calls[0]).toBe('trigger');
  expect([...calls.slice(1)].sort()).toEqual(['a', 's']);
  const full = repo.getRun(run.id)!;
  const byId = new Map(full.steps.map((s) => [s.stepId, s]));
  expect(byId.get('a')!.status).toBe('done');
  expect(byId.get('b')!.status).toBe('skipped');
  expect(byId.get('b')!.why).toBe('Skipped because the condition "a.ok == false" was not met.');
  expect(byId.get('b')!.input).toBeUndefined();
  expect(byId.get('b')!.durationMs).toBeUndefined();
  expect(byId.get('c')!.status).toBe('skipped');
  expect(byId.get('c')!.why).toBe('Skipped because an earlier step was skipped.');
  expect(byId.get('s')!.status).toBe('done');
});

test('step failure fails the run, dependents stay pending, other branches finish', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.extract': async () => {
      calls.push('a');
      throw new Error('Boom');
    },
    'ai.write': async () => {
      calls.push('b');
      return { output: { text: 'unreached' }, why: 'unreached' };
    },
    'table.upsert': async () => {
      calls.push('c');
      return { output: { id: 1, created: true }, why: 'Saved.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } }),
        mkStep('b', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{a}}' } }),
        mkStep('c', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{trigger}}' },
        }),
      ],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'trigger', to: 'c' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('failed');
  expect(calls).not.toContain('b');
  const full = repo.getRun(run.id)!;
  const byId = new Map(full.steps.map((s) => [s.stepId, s]));
  expect(byId.get('a')!.status).toBe('failed');
  expect(byId.get('a')!.error).toBe('Boom');
  expect(byId.get('a')!.input).toEqual({ text: 't' });
  expect(typeof byId.get('a')!.durationMs).toBe('number');
  // b was pre-created and never became ready: a literal pending row.
  expect(byId.get('b')).toBeDefined();
  expect(byId.get('b')!.status).toBe('pending');
  expect(byId.get('c')!.status).toBe('done');
});

test('output violating outputSchema fails the step', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.write': async () => ({ output: { text: 42 }, why: 'bad shape' }),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.write', { config: WRITE_CONFIG, inputs: { context: '{{trigger}}' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('failed');
  const full = repo.getRun(run.id)!;
  const a = full.steps.find((s) => s.stepId === 'a')!;
  expect(a.status).toBe('failed');
  expect(a.error).toMatch(/string/i);
});

test('events emits a step event for every StepRun change', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: { ok: true }, why: 'Extracted.' }),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  const seen: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => seen.push(e));
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  await engine.start('wf1', { payload: 1 });

  const stepSeq = seen
    .filter((e): e is Extract<EngineEvent, { type: 'step' }> => e.type === 'step')
    .map((e) => `${e.stepRun.stepId}:${e.stepRun.status}`);
  expect(stepSeq).toEqual([
    'trigger:pending',
    'a:pending',
    'trigger:running',
    'trigger:done',
    'a:running',
    'a:done',
  ]);
  const runSeq = seen
    .filter((e): e is Extract<EngineEvent, { type: 'run' }> => e.type === 'run')
    .map((e) => e.run.status);
  expect(runSeq).toEqual(['running', 'done']);
  expect(seen).toHaveLength(8);
});

test('invalid config fails the step cleanly instead of crashing the run', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.extract': async () => {
      calls.push('a');
      return { output: {}, why: 'unreached' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: {}, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('failed');
  expect(calls).toEqual(['trigger']);
  const full = repo.getRun(run.id)!;
  const a = full.steps.find((s) => s.stepId === 'a')!;
  expect(a.status).toBe('failed');
  expect(a.error).toBeTruthy();
  expect(a.error).toMatch(/required/i);
});

test('start throws for an unknown workflow', async () => {
  const { repo, ctxBase } = setup();
  const engine = createEngine({ repo, executors: {}, ctx: ctxBase });
  await expect(engine.start('nope', {})).rejects.toThrow('Unknown workflow: nope');
});

test('start throws for an unknown step type before any run exists', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'bogus.type')],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  await expect(engine.start('wf1', { payload: 1 })).rejects.toThrow('Unknown step type: bogus.type');
  expect(repo.listRuns()).toEqual([]);
});

test('start throws for a cyclic workflow before any run exists', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: {}, why: 'unreached' }),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  // saveWorkflow validates endpoints but not cycles, so this saves fine.
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'trigger' },
      ],
    }),
  );

  await expect(engine.start('wf1', { payload: 1 })).rejects.toThrow('Workflow has a cycle');
  expect(repo.listRuns()).toEqual([]);
});

test('trigger executes with the raw payload and downstream bindings see it', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  let capturedInput: unknown;
  const executors: Record<string, Executor> = {
    'trigger.gmailButton': echoExecutor(calls, 'trigger'),
    'ai.extract': async (_config, input) => {
      capturedInput = input;
      return { output: { ok: true }, why: 'Extracted.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      trigger: mkStep('trigger', 'trigger.gmailButton', { config: { label: 'Do it' } }),
      steps: [
        mkStep('a', 'ai.extract', {
          config: EXTRACT_CONFIG,
          inputs: { text: 'Hi {{trigger.email.fromName}}!' },
        }),
      ],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const payload = {
    email: {
      from: 'owner@example.com',
      fromName: 'Sam',
      subject: 'Hi',
      body: 'hello',
      threadId: 't1',
    },
  };
  const run = await engine.start('wf1', payload);

  expect(run.status).toBe('done');
  const full = repo.getRun(run.id)!;
  expect(full.steps.find((s) => s.stepId === 'trigger')!.output).toEqual(payload);
  expect(capturedInput).toEqual({ text: 'Hi Sam!' });
});

test('input violating inputSchema fails the step', async () => {
  const { repo, ctxBase } = setup();
  const calls: string[] = [];
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor(calls, 'trigger'),
    'ai.extract': async () => {
      calls.push('a');
      return { output: { ok: true }, why: 'unreached' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      // Pure-expression binding keeps the raw object type, so `text` resolves
      // to an object and violates ai.extract's { text: string } inputSchema.
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: '{{trigger}}' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('failed');
  expect(calls).toEqual(['trigger']);
  const full = repo.getRun(run.id)!;
  const a = full.steps.find((s) => s.stepId === 'a')!;
  expect(a.status).toBe('failed');
  expect(a.error).toMatch(/string/i);
});

test('a throwing event listener never breaks a run', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: { ok: true }, why: 'Extracted.' }),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  engine.events.on('event', () => {
    throw new Error('subscriber blew up');
  });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  const full = repo.getRun(run.id)!;
  expect(full.steps).toHaveLength(2);
  for (const sr of full.steps) expect(sr.status).toBe('done');
});

test('persistent repo failure rejects start() after a best-effort failed-mark', async () => {
  const { repo, ctxBase } = setup();
  // The repo is closure-based (no `this`), so a spread override is faithful.
  const failingRepo = {
    ...repo,
    upsertStepRun: (): void => {
      throw new Error('store down');
    },
  };
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
  };
  const engine = createEngine({ repo: failingRepo, executors, ctx: ctxBase });
  const seen: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => seen.push(e));
  repo.saveWorkflow(mkWorkflow({}));

  await expect(engine.start('wf1', { payload: 1 })).rejects.toThrow('store down');
  const runs = repo.listRuns();
  expect(runs).toHaveLength(1);
  expect(runs[0]!.status).toBe('failed');
  const runSeq = seen
    .filter((e): e is Extract<EngineEvent, { type: 'run' }> => e.type === 'run')
    .map((e) => e.run.status);
  expect(runSeq).toEqual(['running', 'failed']);
});

test('executor omitting why still yields done with a Finished. fallback', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': (async () => ({ output: { ok: true } })) as unknown as Executor,
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  const a = repo.getRun(run.id)!.steps.find((s) => s.stepId === 'a')!;
  expect(a.status).toBe('done');
  expect(a.why).toBe('Finished.');
});

test('executor receives a live AbortSignal in ctx', async () => {
  const { repo, ctxBase } = setup();
  let captured: unknown;
  const executors: Record<string, Executor> = {
    'trigger.manual': async (_config, input, ctx) => {
      captured = ctx.signal;
      return { output: input, why: 'Started manually.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(mkWorkflow({}));

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  expect(captured).toBeInstanceOf(AbortSignal);
  expect((captured as AbortSignal).aborted).toBe(false);
});

test('executors omitting cost fields store undefined, never 0/NaN', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(mkWorkflow({}));

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  const trigger = repo.getRun(run.id)!.steps.find((s) => s.stepId === 'trigger')!;
  expect(trigger.status).toBe('done');
  expect(trigger.costUsd).toBeUndefined();
  expect(trigger.model).toBeUndefined();
  expect(trigger.tokens).toBeUndefined();
});

test('failing step emits pending→running→failed in order', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => {
      throw new Error('Boom');
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  const seen: EngineEvent[] = [];
  engine.events.on('event', (e: EngineEvent) => seen.push(e));
  repo.saveWorkflow(
    mkWorkflow({
      steps: [mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } })],
      edges: [{ from: 'trigger', to: 'a' }],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('failed');
  const states = seen
    .filter(
      (e): e is Extract<EngineEvent, { type: 'step' }> =>
        e.type === 'step' && e.stepRun.stepId === 'a',
    )
    .map((e) => e.stepRun.status);
  expect(states).toEqual(['pending', 'running', 'failed']);
});

test('skip names the first false when in workflow.edges order', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: { ok: true }, why: 'Extracted.' }),
    'gmail.draftReply': async () => ({ output: { drafted: true }, why: 'Drafted.' }),
    'ai.write': async () => ({ output: { text: 'unreached' }, why: 'unreached' }),
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } }),
        mkStep('s', 'gmail.draftReply', { inputs: { threadId: 't1', body: 'hi' } }),
        mkStep('b', 'ai.write', { config: WRITE_CONFIG, inputs: { context: 'x' } }),
      ],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'trigger', to: 's' },
        { from: 'a', to: 'b', when: 'a.ok == false' },
        { from: 's', to: 'b', when: 's.drafted == false' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  const b = repo.getRun(run.id)!.steps.find((s) => s.stepId === 'b')!;
  expect(b.status).toBe('skipped');
  expect(b.why).toContain('a.ok == false');
});

test('diamond fan-in executes the join step exactly once', async () => {
  const { repo, ctxBase } = setup();
  let dCalls = 0;
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: { ok: true }, why: 'Extracted.' }),
    'ai.write': async () => ({ output: { text: 'hi' }, why: 'Wrote.' }),
    'table.upsert': async () => {
      dCalls += 1;
      return { output: { id: 1, created: true }, why: 'Saved.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('a', 'ai.extract', { config: EXTRACT_CONFIG, inputs: { text: 't' } }),
        mkStep('b', 'ai.write', { config: WRITE_CONFIG, inputs: { context: 'c' } }),
        mkStep('d', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{a}}' },
        }),
      ],
      edges: [
        { from: 'trigger', to: 'a' },
        { from: 'trigger', to: 'b' },
        { from: 'a', to: 'd' },
        { from: 'b', to: 'd' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: 1 });

  expect(run.status).toBe('done');
  expect(dCalls).toBe(1);
  const d = repo.getRun(run.id)!.steps.find((s) => s.stepId === 'd')!;
  expect(d.status).toBe('done');
});

test('hyphenated step ids resolve whole-output refs (agent slug-nanoid ids)', async () => {
  const { repo, ctxBase } = setup();
  const executors: Record<string, Executor> = {
    'trigger.manual': echoExecutor([], 'trigger'),
    'ai.extract': async () => ({ output: { ok: true }, why: 'Extracted.' }),
    'table.upsert': async (_config, input) => {
      // Before the bindings fix this arrived as { row: NaN } (jexl read the
      // hyphens as subtraction) and failed input validation.
      expect(input).toEqual({ row: { ok: true } });
      return { output: { id: 1, created: true }, why: 'Saved.' };
    },
  };
  const engine = createEngine({ repo, executors, ctx: ctxBase });
  repo.saveWorkflow(
    mkWorkflow({
      steps: [
        mkStep('extract-details-XhfhTM', 'ai.extract', {
          config: EXTRACT_CONFIG,
          inputs: { text: 'hello there' },
        }),
        mkStep('save-to-customers-M6Iw6', 'table.upsert', {
          config: { table: 'customers', keyField: 'email' },
          inputs: { row: '{{extract-details-XhfhTM}}' },
        }),
      ],
      edges: [
        { from: 'trigger', to: 'extract-details-XhfhTM' },
        { from: 'extract-details-XhfhTM', to: 'save-to-customers-M6Iw6' },
      ],
    }),
  );

  const run = await engine.start('wf1', { payload: { note: 'hi' } });
  expect(run.status).toBe('done');
});
