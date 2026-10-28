import type { Run, StepInstance, StepRun, Workflow } from '@dad/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createTableStore } from '../src/tables/store.js';

function step(id: string, title: string): StepInstance {
  return {
    id,
    type: 'test.step',
    title,
    summary: 'test step',
    config: {},
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'flow-1',
    name: 'Flow 1',
    description: 'test workflow',
    version: 1,
    status: 'draft',
    trigger: step('trigger', 'Trigger'),
    steps: [step('step-1', 'Step one')],
    edges: [{ from: 'trigger', to: 'step-1' }],
    ...overrides,
  };
}

function freshRepo(): Repo {
  const db = openDb(':memory:');
  return createRepo(db);
}

function makeRunInput(workflowId = 'flow-1'): Omit<Run, 'id' | 'startedAt'> {
  return { workflowId, workflowVersion: 1, triggerPayload: { hello: 'world' }, status: 'running' };
}

function makeStepRun(runId: string, overrides?: Partial<StepRun>): StepRun {
  return {
    id: `sr-${Math.random().toString(36).slice(2)}`,
    runId,
    stepId: 'step-1',
    status: 'done',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('saving the same workflow twice unchanged keeps version 1', () => {
  const repo = freshRepo();
  const first = repo.saveWorkflow(makeWorkflow());
  expect(first.version).toBe(1);
  const second = repo.saveWorkflow(makeWorkflow());
  expect(second.version).toBe(1);
  expect(repo.getWorkflow('flow-1')?.version).toBe(1);
});

test('changing a step title makes version 2 and v1 stays intact', () => {
  const repo = freshRepo();
  repo.saveWorkflow(makeWorkflow());
  const changed = makeWorkflow({ steps: [step('step-1', 'Step one renamed')] });
  const saved = repo.saveWorkflow(changed);
  expect(saved.version).toBe(2);
  expect(repo.getWorkflow('flow-1')?.version).toBe(2);
  expect(repo.getWorkflow('flow-1')?.steps[0]?.title).toBe('Step one renamed');
  const v1 = repo.getWorkflow('flow-1', 1);
  expect(v1?.version).toBe(1);
  expect(v1?.steps[0]?.title).toBe('Step one');
});

test('a status flip bumps the version', () => {
  const repo = freshRepo();
  repo.saveWorkflow(makeWorkflow());
  const flipped = repo.saveWorkflow(makeWorkflow({ status: 'on' }));
  expect(flipped.version).toBe(2);
  expect(repo.getWorkflow('flow-1')?.status).toBe('on');
  expect(repo.getWorkflow('flow-1', 1)?.status).toBe('draft');
});

test('getWorkflow returns undefined for unknown id or version', () => {
  const repo = freshRepo();
  repo.saveWorkflow(makeWorkflow());
  expect(repo.getWorkflow('nope')).toBeUndefined();
  expect(repo.getWorkflow('flow-1', 99)).toBeUndefined();
});

test('listWorkflows returns the latest version of each workflow', () => {
  const repo = freshRepo();
  repo.saveWorkflow(makeWorkflow());
  repo.saveWorkflow(makeWorkflow({ steps: [step('step-1', 'v2 title')] }));
  repo.saveWorkflow(makeWorkflow({ id: 'flow-2', name: 'Flow 2' }));
  const all = repo.listWorkflows();
  expect(all).toHaveLength(2);
  const flow1 = all.find((w) => w.id === 'flow-1');
  expect(flow1?.version).toBe(2);
  expect(flow1?.steps[0]?.title).toBe('v2 title');
});

test('upsertStepRun twice with the same id updates in place', () => {
  const repo = freshRepo();
  const run = repo.createRun(makeRunInput());
  const sr = makeStepRun(run.id, { id: 'sr-1', status: 'running', output: { partial: true } });
  repo.upsertStepRun(sr);
  repo.upsertStepRun({ ...sr, status: 'done', output: { partial: false, answer: 42 } });
  const got = repo.getRun(run.id);
  expect(got?.steps).toHaveLength(1);
  expect(got?.steps[0]?.id).toBe('sr-1');
  expect(got?.steps[0]?.status).toBe('done');
  expect(got?.steps[0]?.output).toEqual({ partial: false, answer: 42 });
});

test('listRuns is newest first', () => {
  const repo = freshRepo();
  const a = repo.createRun(makeRunInput());
  const b = repo.createRun(makeRunInput());
  const c = repo.createRun(makeRunInput());
  const ids = repo.listRuns().map((r) => r.id);
  expect(ids).toEqual([c.id, b.id, a.id]);
});

test('updateRun patches status and endedAt', () => {
  const repo = freshRepo();
  const run = repo.createRun(makeRunInput());
  repo.updateRun(run.id, { status: 'done', endedAt: '2026-10-28T00:00:01.000Z', id: 'ignored' });
  const got = repo.getRun(run.id);
  expect(got?.run.id).toBe(run.id);
  expect(got?.run.status).toBe('done');
  expect(got?.run.endedAt).toBe('2026-10-28T00:00:01.000Z');
  expect(got?.run.startedAt).toBe(run.startedAt);
});

test('key order in the definition does not cause phantom version bumps', () => {
  const repo = freshRepo();
  repo.saveWorkflow(makeWorkflow());
  const reordered = JSON.parse(
    JSON.stringify(makeWorkflow()),
    (_key: string, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse())
        : value,
  ) as Workflow;
  expect(repo.saveWorkflow(reordered).version).toBe(1);
});

test('listRuns filters by workflow and honors limit', () => {
  const repo = freshRepo();
  repo.createRun(makeRunInput('flow-1'));
  repo.createRun(makeRunInput('flow-2'));
  const latest = repo.createRun(makeRunInput('flow-1'));
  expect(repo.listRuns({ workflowId: 'flow-2' })).toHaveLength(1);
  const limited = repo.listRuns({ workflowId: 'flow-1', limit: 1 });
  expect(limited).toHaveLength(1);
  expect(limited[0]?.id).toBe(latest.id);
  expect(repo.listRuns({ limit: 0 })).toEqual([]);
  expect(() => repo.listRuns({ limit: -1 })).toThrow('Invalid limit: -1');
  expect(() => repo.listRuns({ limit: 1.5 })).toThrow('Invalid limit: 1.5');
});

test('repo coexists with the table store on the same database', () => {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const store = createTableStore(db);
  repo.saveWorkflow(makeWorkflow());
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'name', label: 'Name', type: 'text' }],
    displayField: 'name',
  });
  expect(repo.getWorkflow('flow-1')?.version).toBe(1);
  expect(store.getTable('customers')?.name).toBe('customers');
});

test('getRun returns undefined for unknown id', () => {
  const repo = freshRepo();
  expect(repo.getRun('nope')).toBeUndefined();
});

test('updateRun throws for unknown id', () => {
  const repo = freshRepo();
  expect(() => repo.updateRun('nope', { status: 'done' })).toThrow('Unknown run: nope');
});

test('nested input/output/tokens objects survive a JSON round-trip', () => {
  const repo = freshRepo();
  const run = repo.createRun(makeRunInput());
  expect(run.triggerPayload).toEqual({ hello: 'world' });
  repo.upsertStepRun(
    makeStepRun(run.id, {
      id: 'sr-json',
      input: { prompt: 'hi', nested: { deep: [1, 2, { three: true }] } },
      output: { text: 'hello', scores: [0.1, 0.9] },
      tokens: { input: 12, output: 34 },
      costUsd: 0.000123,
      durationMs: 1500,
    }),
  );
  const got = repo.getRun(run.id);
  expect(got?.run.triggerPayload).toEqual({ hello: 'world' });
  expect(got?.steps[0]?.input).toEqual({ prompt: 'hi', nested: { deep: [1, 2, { three: true }] } });
  expect(got?.steps[0]?.output).toEqual({ text: 'hello', scores: [0.1, 0.9] });
  expect(got?.steps[0]?.tokens).toEqual({ input: 12, output: 34 });
  expect(got?.steps[0]?.costUsd).toBeCloseTo(0.000123, 9);
  expect(got?.steps[0]?.durationMs).toBe(1500);
});

test('saveWorkflow ignores an incoming version and stores as version 1', () => {
  const repo = freshRepo();
  const saved = repo.saveWorkflow(makeWorkflow({ version: 999 }));
  expect(saved.version).toBe(1);
  expect(repo.getWorkflow('flow-1')?.version).toBe(1);
});

test('updateRun with an invalid status throws', () => {
  const repo = freshRepo();
  const run = repo.createRun(makeRunInput());
  expect(() => repo.updateRun(run.id, { status: 'bogus' as never })).toThrow(/status/i);
});

test('upsertStepRun for an unknown run id is allowed (no FK)', () => {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  repo.upsertStepRun(makeStepRun('ghost-run', { id: 'sr-ghost' }));
  expect(repo.getRun('ghost-run')).toBeUndefined();
  const row = db.prepare('SELECT id, run_id FROM step_runs WHERE id = ?').get('sr-ghost') as {
    id: string;
    run_id: string;
  };
  expect(row).toMatchObject({ id: 'sr-ghost', run_id: 'ghost-run' });
});
