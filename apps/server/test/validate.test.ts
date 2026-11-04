import { Workflow, catalog, type Workflow as WorkflowType } from '@onesaas/shared';
import { expect, test } from 'vitest';
import { openDb } from '../src/db/connection.js';
import flow1Seed from '../src/seed/flow1.json' with { type: 'json' };
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { checkWorkflow } from '../src/workflows/validate.js';

function setup(): { tables: TableStore; flow1: WorkflowType } {
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
  return { tables, flow1: Workflow.parse(flow1Seed) };
}

function withSteps(flow1: WorkflowType, steps: WorkflowType['steps']): WorkflowType {
  return Workflow.parse({ ...flow1, steps });
}

test('pristine flow 1 has no problems', () => {
  const { tables, flow1 } = setup();
  expect(checkWorkflow(flow1, tables)).toEqual([]);
});

test('unknown step type', () => {
  const { tables, flow1 } = setup();
  const wf = withSteps(
    flow1,
    flow1.steps.map((s) => (s.id === 'extract' ? { ...s, type: 'ai.dance' } : s)),
  );
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'extract', problem: 'I don\'t know how to do "ai.dance" yet.' },
  ]);
});

test('config failing the schema names the first missing path', () => {
  const { tables, flow1 } = setup();
  const wf = withSteps(
    flow1,
    flow1.steps.map((s) => (s.id === 'write' ? { ...s, config: {} } : s)),
  );
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'write', problem: "This step isn't set up yet: instructions is missing." },
  ]);
});

test('trigger config is checked too', () => {
  const { tables, flow1 } = setup();
  const wf = Workflow.parse({ ...flow1, trigger: { ...flow1.trigger, config: {} } });
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'trigger', problem: "This step isn't set up yet: label is missing." },
  ]);
});

test('binding to an existing step that is not upstream', () => {
  const { tables, flow1 } = setup();
  const wf = withSteps(
    flow1,
    flow1.steps.map((s) => (s.id === 'save' ? { ...s, inputs: { row: '{{draft.id}}' } } : s)),
  );
  expect(checkWorkflow(wf, tables)).toEqual([
    {
      stepId: 'save',
      problem: 'Needs an input from a step that isn\'t before it ("draft.id").',
    },
  ]);
});

test('binding to a removed step', () => {
  const { tables, flow1 } = setup();
  const wf = Workflow.parse({
    ...flow1,
    steps: flow1.steps.filter((s) => s.id !== 'extract'),
    edges: flow1.edges.filter((e) => e.from !== 'extract' && e.to !== 'extract'),
  });
  const problems = checkWorkflow(wf, tables);
  expect(problems.filter((p) => p.stepId === 'save').map((p) => p.problem)).toContain(
    'Needs an input from a removed step.',
  );
  expect(problems.filter((p) => p.stepId === 'write').map((p) => p.problem)).toContain(
    'Needs an input from a removed step.',
  );
});

test('table step referencing a missing list', () => {
  const { tables, flow1 } = setup();
  const wf = withSteps(
    flow1,
    flow1.steps.map((s) =>
      s.id === 'save' ? { ...s, config: { table: 'leads', keyField: 'email' } } : s,
    ),
  );
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'save', problem: 'The list "leads" doesn\'t exist yet.' },
  ]);
});

test('unreachable step', () => {
  const { tables, flow1 } = setup();
  const wf = Workflow.parse({
    ...flow1,
    steps: [
      ...flow1.steps,
      {
        id: 'orphan',
        type: 'ai.write',
        title: 'Orphan',
        summary: 'Not connected to anything.',
        config: { instructions: 'Write something.', tone: 'brief' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
  });
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'orphan', problem: 'Nothing leads to this step yet.' },
  ]);
});

test('cycle members are reported', () => {
  const { tables, flow1 } = setup();
  const wf = Workflow.parse({
    ...flow1,
    steps: [
      {
        id: 'a',
        type: 'ai.write',
        title: 'A',
        summary: 'A.',
        config: { instructions: 'Write.', tone: 'brief' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'b',
        type: 'ai.write',
        title: 'B',
        summary: 'B.',
        config: { instructions: 'Write.', tone: 'brief' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [
      { from: 'trigger', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ],
  });
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'a', problem: 'These steps go round in a circle.' },
    { stepId: 'b', problem: 'These steps go round in a circle.' },
  ]);
});

test('self-loop is a cycle', () => {
  const { tables, flow1 } = setup();
  const wf = Workflow.parse({
    ...flow1,
    steps: [
      {
        id: 'a',
        type: 'ai.write',
        title: 'A',
        summary: 'A.',
        config: { instructions: 'Write.', tone: 'brief' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [
      { from: 'trigger', to: 'a' },
      { from: 'a', to: 'a' },
    ],
  });
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'a', problem: 'These steps go round in a circle.' },
  ]);
});

function sortFlow(o: {
  classifyConfig?: Record<string, unknown>;
  when?: string;
  classifyId?: string;
}): WorkflowType {
  const classifyId = o.classifyId ?? 'sort';
  return Workflow.parse({
    id: 'sort-flow',
    name: 'Sort flow',
    description: 'A sort.',
    version: 1,
    status: 'draft',
    trigger: {
      id: 'trigger',
      type: 'trigger.manual',
      title: 'Manual trigger',
      summary: 'Runs when you start it by hand.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [
      {
        id: classifyId,
        type: 'ai.classify',
        title: 'Sort',
        summary: 'Sort.',
        config: { question: 'Booking?', ...(o.classifyConfig ?? {}) },
        inputs: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'write',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Write.',
        config: { instructions: 'Write a short reply.', tone: 'friendly' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [
      { from: 'trigger', to: classifyId },
      {
        from: classifyId,
        to: 'write',
        ...(o.when !== undefined ? { when: o.when } : {}),
      },
    ],
  });
}

test('a condition naming a removed sort step blocks activation on the target', () => {
  const { tables } = setup();
  // Classify was removed and re-added under a new id; the old when survives.
  const wf = sortFlow({ when: 'sort-abc123.choice == \'yes\'', classifyId: 'sort-xyz789' });
  expect(checkWorkflow(wf, tables)).toEqual([
    { stepId: 'write', problem: 'The condition refers to a removed step ("sort-abc123").' },
  ]);
});

test('a condition naming a step that does not sort blocks activation on the target', () => {
  const { tables } = setup();
  const wf = sortFlow({ when: 'write.choice == \'yes\'' });
  expect(checkWorkflow(wf, tables)).toEqual([
    {
      stepId: 'write',
      problem: 'The condition refers to "Write reply", which doesn\'t sort into options.',
    },
  ]);
});

test('a condition using a renamed-away option blocks activation on the target', () => {
  const { tables } = setup();
  const wf = sortFlow({
    classifyConfig: { options: ['yeah', 'nah'] },
    when: 'sort.choice == \'yes\'',
  });
  expect(checkWorkflow(wf, tables)).toEqual([
    {
      stepId: 'write',
      problem: 'The condition uses "yes", which "Sort" no longer offers.',
    },
  ]);
});

test('a valid sort condition and general jexl pass validation', () => {
  const { tables } = setup();
  expect(checkWorkflow(sortFlow({ when: 'sort.choice == \'yes\'' }), tables)).toEqual([]);
  expect(
    checkWorkflow(
      sortFlow({ when: 'freebusy.free == false' }),
      tables,
    ),
  ).toEqual([]);
  // Explicit custom options: a current option passes too.
  expect(
    checkWorkflow(
      sortFlow({ classifyConfig: { options: ['yeah', 'nah'] }, when: 'sort.choice == \'nah\'' }),
      tables,
    ),
  ).toEqual([]);
});

test('every catalog step has a one-sentence description; triggers have samples', () => {
  for (const def of Object.values(catalog)) {
    expect(typeof def.description).toBe('string');
    expect(def.description.length).toBeGreaterThan(0);
  }
  const gmail = catalog['trigger.gmailButton']!;
  expect(gmail.outputSchema.safeParse(gmail.sample).success).toBe(true);
  const manual = catalog['trigger.manual']!;
  expect(manual.outputSchema.safeParse(manual.sample).success).toBe(true);
});
