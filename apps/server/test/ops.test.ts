import { Workflow, catalog, type Workflow as WorkflowType } from '@dad/shared';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createServer } from '../src/main.js';
import flow1Seed from '../src/seed/flow1.json' with { type: 'json' };
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { createWorkflowOps, type WorkflowOps } from '../src/workflows/ops.js';
import { checkWorkflow } from '../src/workflows/validate.js';

type Change = { wf: WorkflowType; note: string; by: 'dad' | 'agent' };

function setup(o?: { onChange?: (wf: WorkflowType, note: string, by: 'dad' | 'agent') => void }): {
  repo: Repo;
  tables: TableStore;
  ops: WorkflowOps;
} {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'need', label: 'Need', type: 'text' },
      { name: 'urgency', label: 'Urgency', type: 'text' },
    ],
    displayField: 'name',
    keyField: 'email',
  });
  const repo = createRepo(db);
  repo.saveWorkflow(Workflow.parse(flow1Seed));
  const ops = createWorkflowOps({
    repo,
    tables,
    catalog,
    ...(o?.onChange ? { onChange: o.onChange } : {}),
  });
  return { repo, tables, ops };
}

const WRITE_CONFIG = { instructions: 'Write a short reply.', tone: 'friendly' } as const;

function addWrite(
  ops: WorkflowOps,
  o?: { after?: string; title?: string; inputs?: Record<string, string> },
) {
  return ops.addStep('flow-1', {
    type: 'ai.write',
    title: o?.title ?? 'Write reply',
    summary: 'Write a short reply.',
    config: { ...WRITE_CONFIG },
    inputs: o?.inputs ?? { context: '{{extract}}' },
    ...(o?.after ? { after: o.after } : {}),
  });
}

test('create makes a draft workflow with a manual trigger', () => {
  const { repo, ops } = setup();
  const wf = ops.create({ name: 'Sunday invoices', description: 'Chase unpaid invoices.' });
  expect(wf.name).toBe('Sunday invoices');
  expect(wf.description).toBe('Chase unpaid invoices.');
  expect(wf.status).toBe('draft');
  expect(wf.version).toBe(1);
  expect(wf.trigger.type).toBe('trigger.manual');
  expect(wf.steps).toEqual([]);
  expect(wf.edges).toEqual([]);
  expect(wf.id).toMatch(/^wf-[A-Za-z0-9_-]{6}$/);
  expect(repo.getWorkflow(wf.id)).toEqual(wf);
});

test('setTrigger swaps the trigger and keeps its id, position and edges', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.setTrigger('flow-1', { type: 'trigger.manual', config: {} });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.trigger.type).toBe('trigger.manual');
  expect(res.workflow.trigger.id).toBe('trigger');
  expect(res.workflow.trigger.title).toBe('Manual trigger');
  expect(res.workflow.trigger.position).toEqual(before.trigger.position);
  expect(res.workflow.edges).toEqual(before.edges);
  expect(res.workflow.version).toBe(before.version + 1);
  expect(res.note).toBe('Set the trigger to "Manual trigger".');
});

test('setTrigger with an unknown type is refused', () => {
  const { ops } = setup();
  expect(ops.setTrigger('flow-1', { type: 'trigger.pigeon', config: {} })).toEqual({
    ok: false,
    error: 'I don\'t know how to do "trigger.pigeon" yet.',
  });
});

test('addStep with an unknown type is refused', () => {
  const { ops } = setup();
  expect(
    ops.addStep('flow-1', {
      type: 'ai.dance',
      title: 'Dance',
      summary: 'Dance.',
      config: {},
      inputs: {},
    }),
  ).toEqual({ ok: false, error: 'I don\'t know how to do "ai.dance" yet.' });
});

test('addStep with a binding to a step that is not upstream is refused', () => {
  const { ops } = setup();
  const res = ops.addStep('flow-1', {
    type: 'ai.write',
    title: 'Write reply',
    summary: 'Write a short reply.',
    config: { ...WRITE_CONFIG },
    inputs: { context: '{{extrct.name}}' },
    after: 'extract',
  });
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.error).toBe('Needs an input from a step that isn\'t before it ("extrct.name").');
});

test('addStep after an unknown step is refused', () => {
  const { ops } = setup();
  expect(addWrite(ops, { after: 'nope' })).toEqual({
    ok: false,
    error: 'Unknown step: nope',
  });
});

test('addStep with after adds the step, the edge, and a slugged id', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = addWrite(ops, { after: 'extract', title: 'Write thank-you' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const added = res.workflow.steps.find((s) => s.title === 'Write thank-you')!;
  expect(added.id).toMatch(/^write-thank-you-[A-Za-z0-9_-]{6}$/);
  expect(added.inputs).toEqual({ context: '{{extract}}' });
  expect(res.workflow.edges).toContainEqual({ from: 'extract', to: added.id });
  expect(res.workflow.version).toBe(before.version + 1);
  expect(res.note).toBe('Added step "Write thank-you" after "Extract details".');
});

test('addStep without after adds no edge', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.addStep('flow-1', {
    type: 'ai.write',
    title: 'Write reply',
    summary: 'Write a short reply.',
    config: { ...WRITE_CONFIG },
    inputs: {},
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.edges).toEqual(before.edges);
  expect(res.note).toBe('Added step "Write reply".');
});

test('updateStep patches fields and bumps the version', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.updateStep('flow-1', 'save', { title: 'Save to Customers v2' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.steps.find((s) => s.id === 'save')?.title).toBe('Save to Customers v2');
  expect(res.workflow.version).toBe(before.version + 1);
  expect(res.note).toBe('Updated step "Save to Customers v2".');
});

test('updateStep with a bad binding is refused', () => {
  const { ops } = setup();
  expect(ops.updateStep('flow-1', 'save', { inputs: { row: '{{draft.id}}' } })).toEqual({
    ok: false,
    error: 'Needs an input from a step that isn\'t before it ("draft.id").',
  });
});

test('updateStep allows non-input patches while the step has a dangling binding', () => {
  const { repo, tables, ops } = setup();
  expect(ops.removeStep('flow-1', 'extract').ok).toBe(true);
  const res = ops.updateStep('flow-1', 'save', { title: 'Save v2' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.steps.find((s) => s.id === 'save')?.title).toBe('Save v2');
  // The dangling binding is untouched: checkWorkflow still reports it.
  expect(res.workflow.steps.find((s) => s.id === 'save')?.inputs).toEqual({ row: '{{extract}}' });
  expect(
    checkWorkflow(repo.getWorkflow('flow-1')!, tables)
      .filter((p) => p.stepId === 'save')
      .map((p) => p.problem),
  ).toContain('Needs an input from a removed step.');
});

test('updateStep can clear dangling bindings after a removeStep', () => {
  const { repo, tables, ops } = setup();
  expect(ops.removeStep('flow-1', 'extract').ok).toBe(true);
  const res = ops.updateStep('flow-1', 'save', { inputs: {} });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.steps.find((s) => s.id === 'save')?.inputs).toEqual({});
  expect(
    checkWorkflow(repo.getWorkflow('flow-1')!, tables)
      .filter((p) => p.stepId === 'save')
      .map((p) => p.problem),
  ).not.toContain('Needs an input from a removed step.');
});

test('updateStep can re-point a binding to a newly connected upstream step', () => {
  const { ops } = setup();
  expect(ops.removeStep('flow-1', 'extract').ok).toBe(true);
  const added = ops.addStep('flow-1', {
    type: 'ai.extract',
    title: 'Extract details',
    summary: 'Read details from the email.',
    config: { instructions: 'Extract the details.' },
    inputs: {},
    after: 'trigger',
  });
  expect(added.ok).toBe(true);
  if (!added.ok) return;
  const newId = added.workflow.steps.find((s) => s.title === 'Extract details')!.id;
  expect(ops.connect('flow-1', { from: newId, to: 'save' }).ok).toBe(true);
  const res = ops.updateStep('flow-1', 'save', { inputs: { row: `{{${newId}}}` } });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.steps.find((s) => s.id === 'save')?.inputs).toEqual({
    row: `{{${newId}}}`,
  });
});

test('updateStep refuses a binding to a step that does not exist', () => {
  const { ops } = setup();
  expect(ops.updateStep('flow-1', 'save', { inputs: { row: '{{nonexistent.x}}' } })).toEqual({
    ok: false,
    error: 'Needs an input from a removed step.',
  });
});

test('updateStep refuses unknown patch keys without versioning', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.updateStep(
    'flow-1',
    'save',
    { type: 'ai.dance' } as unknown as { title: string },
  );
  expect(res).toEqual({ ok: false, error: 'Unknown field: type' });
  expect(repo.getWorkflow('flow-1')!.version).toBe(before.version);
  expect(repo.getWorkflow('flow-1')!.steps.find((s) => s.id === 'save')?.type).toBe(
    'table.upsert',
  );
});

test('updateStep on an unknown step is refused', () => {
  const { ops } = setup();
  expect(ops.updateStep('flow-1', 'nope', { title: 'x' })).toEqual({
    ok: false,
    error: 'Unknown step: nope',
  });
});

test('removeStep succeeds and leaves removed-step problems; turn on is blocked', () => {
  const { repo, tables, ops } = setup();
  const res = ops.removeStep('flow-1', 'extract');
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.note).toBe('Removed step "Extract details".');
  expect(res.workflow.steps.some((s) => s.id === 'extract')).toBe(false);
  expect(res.workflow.edges.some((e) => e.from === 'extract' || e.to === 'extract')).toBe(false);
  const problems = checkWorkflow(repo.getWorkflow('flow-1')!, tables);
  expect(problems.filter((p) => p.stepId === 'save').map((p) => p.problem)).toContain(
    'Needs an input from a removed step.',
  );
  expect(problems.filter((p) => p.stepId === 'write').map((p) => p.problem)).toContain(
    'Needs an input from a removed step.',
  );
  const on = ops.setStatus('flow-1', 'on');
  expect(on.ok).toBe(false);
  if (on.ok) return;
  expect(on.error).toBe(
    'Cannot turn on yet: "Save to Customers": Needs an input from a removed step.',
  );
});

test('removeStep refuses the trigger and unknown steps', () => {
  const { ops } = setup();
  expect(ops.removeStep('flow-1', 'trigger')).toEqual({
    ok: false,
    error: 'Cannot remove the trigger.',
  });
  expect(ops.removeStep('flow-1', 'nope')).toEqual({ ok: false, error: 'Unknown step: nope' });
});

test('connect that would make a cycle is refused', () => {
  const { ops } = setup();
  expect(ops.connect('flow-1', { from: 'draft', to: 'extract' })).toEqual({
    ok: false,
    error: 'These steps go round in a circle.',
  });
});

test('connect adds the edge; duplicates and unknown steps are refused', () => {
  const { ops } = setup();
  const wf = ops.create({ name: 'Chain', description: 'A chain.' });
  const a = ops.addStep(wf.id, {
    type: 'ai.write',
    title: 'First',
    summary: 'First.',
    config: { ...WRITE_CONFIG },
    inputs: {},
    after: 'trigger',
  });
  expect(a.ok).toBe(true);
  if (!a.ok) return;
  const aId = a.workflow.steps[0]!.id;
  const b = ops.addStep(wf.id, {
    type: 'ai.write',
    title: 'Second',
    summary: 'Second.',
    config: { ...WRITE_CONFIG },
    inputs: {},
  });
  expect(b.ok).toBe(true);
  if (!b.ok) return;
  const bId = b.workflow.steps.find((s) => s.title === 'Second')!.id;
  const res = ops.connect(wf.id, { from: aId, to: bId });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.edges).toContainEqual({ from: aId, to: bId });
  expect(res.note).toBe('Connected "First" to "Second".');
  expect(ops.connect(wf.id, { from: aId, to: bId })).toEqual({
    ok: false,
    error: '"First" is already connected to "Second".',
  });
  expect(ops.connect(wf.id, { from: aId, to: 'nope' })).toEqual({
    ok: false,
    error: 'Unknown step: nope',
  });
});

test('disconnect removes the edge; a missing edge is refused', () => {
  const { ops } = setup();
  const res = ops.disconnect('flow-1', { from: 'extract', to: 'save' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.edges).not.toContainEqual({ from: 'extract', to: 'save' });
  expect(res.note).toBe('Disconnected "Extract details" from "Save to Customers".');
  expect(ops.disconnect('flow-1', { from: 'extract', to: 'save' })).toEqual({
    ok: false,
    error: '"Extract details" isn\'t connected to "Save to Customers".',
  });
});

test('move keeps the version number and persists the position in place', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.move('flow-1', 'save', { x: 120, y: 340 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.version).toBe(before.version);
  expect(res.note).toBe('Moved "Save to Customers".');
  const latest = repo.getWorkflow('flow-1')!;
  expect(latest.version).toBe(before.version);
  expect(latest.steps.find((s) => s.id === 'save')?.position).toEqual({ x: 120, y: 340 });
  expect(ops.move('flow-1', 'nope', { x: 0, y: 0 })).toEqual({
    ok: false,
    error: 'Unknown step: nope',
  });
});

test('move, updateStep and rename versioning across a sequence', () => {
  const { ops } = setup();
  const wf = ops.create({ name: 'Seq', description: 'Sequence.' });
  expect(wf.version).toBe(1);
  const added = addWriteOn(ops, wf.id, 'trigger');
  if (!added.ok) return;
  expect(added.workflow.version).toBe(2);
  const stepId = added.workflow.steps[0]!.id;
  const moved = ops.move(wf.id, stepId, { x: 5, y: 6 });
  expect(moved.ok).toBe(true);
  if (!moved.ok) return;
  expect(moved.workflow.version).toBe(2);
  const updated = ops.updateStep(wf.id, stepId, { title: 'Write reply v2' });
  expect(updated.ok).toBe(true);
  if (!updated.ok) return;
  expect(updated.workflow.version).toBe(3);
  const renamed = ops.rename(wf.id, { name: 'Seq v2' });
  expect(renamed.ok).toBe(true);
  if (!renamed.ok) return;
  expect(renamed.workflow.version).toBe(4);
});

function addWriteOn(ops: WorkflowOps, id: string, after: string) {
  return ops.addStep(id, {
    type: 'ai.write',
    title: 'Write reply',
    summary: 'Write a short reply.',
    config: { ...WRITE_CONFIG },
    inputs: {},
    after,
  });
}

test('setStatus off always works; on works when there are no problems', () => {
  const { ops } = setup();
  const off = ops.setStatus('flow-1', 'off');
  expect(off.ok).toBe(true);
  if (!off.ok) return;
  expect(off.workflow.status).toBe('off');
  expect(off.note).toBe('Turned off "Save as lead & reply".');
  const on = ops.setStatus('flow-1', 'on');
  expect(on.ok).toBe(true);
  if (!on.ok) return;
  expect(on.workflow.status).toBe('on');
  expect(on.note).toBe('Turned on "Save as lead & reply".');
});

test('rename changes the name and bumps the version', () => {
  const { repo, ops } = setup();
  const before = repo.getWorkflow('flow-1')!;
  const res = ops.rename('flow-1', { name: 'Leads & replies', description: 'New description.' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.workflow.name).toBe('Leads & replies');
  expect(res.workflow.description).toBe('New description.');
  expect(res.workflow.version).toBe(before.version + 1);
  expect(res.note).toBe('Renamed to "Leads & replies".');
  const kept = ops.rename('flow-1', { name: 'Leads again' });
  expect(kept.ok).toBe(true);
  if (!kept.ok) return;
  expect(kept.workflow.description).toBe('New description.');
});

test('ops on an unknown workflow are refused', () => {
  const { ops } = setup();
  expect(ops.move('nope', 'save', { x: 0, y: 0 })).toEqual({
    ok: false,
    error: 'Unknown workflow: nope',
  });
});

test('onChange is called with the note and by', () => {
  const changes: Change[] = [];
  const { ops } = setup({
    onChange: (wf, note, by) => changes.push({ wf, note, by }),
  });
  const added = addWrite(ops, { after: 'extract' });
  expect(added.ok).toBe(true);
  const renamed = ops.rename('flow-1', { name: 'Renamed' }, { by: 'dad' });
  expect(renamed.ok).toBe(true);
  expect(changes.map((c) => [c.note, c.by])).toEqual([
    ['Added step "Write reply" after "Extract details".', 'agent'],
    ['Renamed to "Renamed".', 'dad'],
  ]);
  expect(changes[0]!.wf.steps.some((s) => s.title === 'Write reply')).toBe(true);
});

test('POST /api/workflows creates a workflow; bad bodies 400', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sunday invoices', description: 'Chase unpaid invoices.' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as WorkflowType;
  expect(body.status).toBe('draft');
  expect(body.trigger.type).toBe('trigger.manual');
  const bad = await app.request('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Missing description' }),
  });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: 'Invalid workflow body' });
});

test('POST /api/workflows/:id/ops dispatches ops and passes by dad', async () => {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  const repo = createRepo(db);
  repo.saveWorkflow(Workflow.parse(flow1Seed));
  const changes: Change[] = [];
  const app = createApp({
    repo,
    tables,
    onWorkflowChange: (wf: WorkflowType, note: string, by: 'dad' | 'agent') =>
      changes.push({ wf, note, by }),
  });
  const res = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'rename', args: [{ name: 'Via web' }] }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; note?: string };
  expect(body.ok).toBe(true);
  expect(changes.map((c) => [c.note, c.by])).toEqual([['Renamed to "Via web".', 'dad']]);

  const cycle = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'connect', args: [{ from: 'draft', to: 'extract' }] }),
  });
  expect(cycle.status).toBe(200);
  expect(await cycle.json()).toMatchObject({
    ok: false,
    error: 'These steps go round in a circle.',
  });

  const unknownOp = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'teleport', args: [] }),
  });
  expect(unknownOp.status).toBe(400);
  expect(await unknownOp.json()).toEqual({ error: 'Unknown op: teleport' });

  const create = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', args: [{ name: 'x', description: 'y' }] }),
  });
  expect(create.status).toBe(400);

  const badArgs = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'move', args: ['save'] }),
  });
  expect(badArgs.status).toBe(400);
  expect(await badArgs.json()).toEqual({ error: 'Invalid op body' });

  const unknownWf = await app.request('/api/workflows/nope/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'rename', args: [{ name: 'x' }] }),
  });
  expect(unknownWf.status).toBe(200);
  expect(await unknownWf.json()).toEqual({ ok: false, error: 'Unknown workflow: nope' });
});

test('POST /api/workflows/:id/ops refuses updateStep with an unknown patch key', async () => {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  const repo = createRepo(db);
  repo.saveWorkflow(Workflow.parse(flow1Seed));
  const app = createApp({ repo, tables });
  const before = repo.getWorkflow('flow-1')!;
  const res = await app.request('/api/workflows/flow-1/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'updateStep', args: ['save', { title: 'x', type: 'ai.dance' }] }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'Invalid op body' });
  expect(repo.getWorkflow('flow-1')).toEqual(before);
});

test('GET /api/workflows/:id returns the workflow plus problems', async () => {
  const { app, repo } = createServer({ dbFile: ':memory:' });
  const ok = await app.request('/api/workflows/flow-1');
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as WorkflowType & {
    problems: { stepId: string; problem: string }[];
  };
  expect(body.id).toBe('flow-1');
  expect(body.problems).toEqual([]);
  expect(body).toMatchObject(repo.getWorkflow('flow-1')!);

  const missing = await app.request('/api/workflows/nope');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'Unknown workflow: nope' });
});
