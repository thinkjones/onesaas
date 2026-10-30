import { Workflow, catalog } from '@dad/shared';
import { vi } from 'vitest';
import { flow1Example, flow2Example } from '../src/agent/examples.js';
import { TANGLED_MESSAGE, buildSystemPrompt } from '../src/agent/prompt.js';
import { builderTools, type AgentEvent, type ToolContext } from '../src/agent/tools.js';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import flow1Seed from '../src/seed/flow1.json' with { type: 'json' };
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { createViewStore } from '../src/views/store.js';
import { createWorkflowOps, type OpBy, type WorkflowOps } from '../src/workflows/ops.js';
import { checkWorkflow } from '../src/workflows/validate.js';

const WRITE_CONFIG = { instructions: 'Write a short reply.', tone: 'friendly' };

function setup() {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  const views = createViewStore({ db, tables });
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
    displayField: 'name',
    keyField: 'email',
  });
  const repo = createRepo(db);
  const wf = repo.createWorkflow({ name: 'Test chore', description: 'A test.' });
  const bys: OpBy[] = [];
  const ops = createWorkflowOps({
    repo,
    tables,
    catalog,
    onChange: (_wf, _note, by) => bys.push(by),
  });
  const events: AgentEvent[] = [];
  const chatJson = vi.fn();
  const gateway = { chatJson, chatTools: vi.fn() } as never;
  const testRun = vi.fn();
  const ctx: ToolContext = {
    workflowId: wf.id,
    ops,
    tables,
    views,
    repo,
    engine: {} as never,
    gateway,
    testRun,
    emit: (e) => events.push(e),
  };
  return { repo, tables, ops, ctx, events, chatJson, testRun, bys, wf };
}

function tool(name: string) {
  const t = builderTools.find((t) => t.name === name);
  if (!t) throw new Error(`Missing tool: ${name}`);
  return t;
}

function planSteps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    key: `s${i + 1}`,
    type: 'ai.write',
    title: `Step ${i + 1}`,
    summary: `Does part ${i + 1}.`,
  }));
}

function planEdges(n: number) {
  return Array.from({ length: n - 1 }, (_, i) => ({ from: `s${i + 1}`, to: `s${i + 2}` }));
}

test('builderTools exposes exactly the sixteen builder tools', () => {
  expect(builderTools.map((t) => t.name).sort()).toEqual(
    [
      'ask_user',
      'propose_plan',
      'create_table',
      'create_workflow',
      'set_trigger',
      'add_step',
      'update_step',
      'remove_step',
      'connect',
      'rename_workflow',
      'test_run',
      'activate',
      'explain',
      'query_table',
      'query_runs',
      'pin_view',
    ].sort(),
  );
});

test("every tool's parameters is JSON Schema with type 'object'", () => {
  for (const t of builderTools) {
    expect(typeof t.description).toBe('string');
    expect(t.description.length).toBeGreaterThan(0);
    const params = t.parameters as Record<string, unknown>;
    expect(typeof params).toBe('object');
    expect(params['type']).toBe('object');
    // JSON-serializable (what the gateway sends to the model).
    expect(() => JSON.stringify(params)).not.toThrow();
  }
});

test('add_step with a bad binding returns a Problem result and does not throw', async () => {
  const { ctx, events } = setup();
  const out = await tool('add_step').run(
    {
      type: 'ai.write',
      title: 'Write reply',
      summary: 'Write a short reply.',
      config: { ...WRITE_CONFIG },
      inputs: { context: '{{nope}}' },
    },
    ctx,
  );
  expect(out.result.startsWith('Problem:')).toBe(true);
  expect(out.endTurn).toBeUndefined();
  expect(events.filter((e) => e.type === 'built')).toEqual([]);
  // Uniform activity: exactly one plain-English line per tool call, even on failure.
  expect(events.filter((e) => e.type === 'activity')).toHaveLength(1);
});

test('add_step marks ops by agent and emits built + activity', async () => {
  const { ctx, events, bys } = setup();
  const out = await tool('add_step').run(
    {
      type: 'ai.write',
      title: 'Write reply',
      summary: 'Write a short reply.',
      config: { ...WRITE_CONFIG },
      inputs: { context: 'hello' },
    },
    ctx,
  );
  expect(out.result.startsWith('Problem:')).toBe(false);
  expect(bys).toEqual(['agent']);
  const built = events.filter((e) => e.type === 'built');
  expect(built).toHaveLength(1);
  expect(events.filter((e) => e.type === 'activity')).toHaveLength(1);
});

test('propose_plan with 7 steps calls the planner role once and emits the refined plan', async () => {
  const { ctx, events, chatJson } = setup();
  const refined = {
    steps: [
      { key: 'r1', type: 'ai.extract', title: 'Read it', summary: 'Read the email.' },
      { key: 'r2', type: 'ai.write', title: 'Write it', summary: 'Write a reply.' },
    ],
    edges: [{ from: 'r1', to: 'r2', when: null }],
  };
  chatJson.mockResolvedValueOnce({ data: refined, model: 'muse-wonder-1.0' });
  const out = await tool('propose_plan').run(
    { steps: planSteps(7), edges: planEdges(7) },
    ctx,
  );
  expect(chatJson).toHaveBeenCalledTimes(1);
  const call = chatJson.mock.calls[0]![0] as Record<string, unknown>;
  expect(call['role']).toBe('planner');
  expect(call['schemaName']).toBe('plan');
  expect(out).toEqual({ result: 'Plan shown to Dad; wait for his reply.', endTurn: true });
  const plans = events.filter((e) => e.type === 'plan');
  expect(plans).toHaveLength(1);
  const plan = plans[0]! as Extract<AgentEvent, { type: 'plan' }>;
  expect(plan.ghosts.map((g) => g.title)).toEqual(['Read it', 'Write it']);
  expect(plan.ghosts.map((g) => g.id)).toEqual(['ghost-r1', 'ghost-r2']);
  expect(plan.edges).toEqual([{ from: 'ghost-r1', to: 'ghost-r2' }]);
});

test('propose_plan with 4 steps and no conditions skips the planner', async () => {
  const { ctx, events, chatJson } = setup();
  const out = await tool('propose_plan').run(
    { steps: planSteps(4), edges: planEdges(4) },
    ctx,
  );
  expect(chatJson).not.toHaveBeenCalled();
  expect(out).toEqual({ result: 'Plan shown to Dad; wait for his reply.', endTurn: true });
  const plans = events.filter((e) => e.type === 'plan');
  expect(plans).toHaveLength(1);
  const plan = plans[0]! as Extract<AgentEvent, { type: 'plan' }>;
  expect(plan.ghosts).toHaveLength(4);
  // Ghost ids derive stably from step keys (no randomness).
  expect(plan.ghosts.map((g) => g.id)).toEqual(['ghost-s1', 'ghost-s2', 'ghost-s3', 'ghost-s4']);
});

test('propose_plan with any edge condition calls the planner', async () => {
  const { ctx, chatJson } = setup();
  chatJson.mockResolvedValueOnce({
    data: { steps: planSteps(4), edges: planEdges(4).map((e) => ({ ...e, when: null })) },
    model: 'muse-wonder-1.0',
  });
  await tool('propose_plan').run(
    {
      steps: planSteps(4),
      edges: [...planEdges(4).slice(0, 2), { from: 's3', to: 's4', when: 'urgent' }],
    },
    ctx,
  );
  expect(chatJson).toHaveBeenCalledTimes(1);
});

test('ghost ids are stable across identical propose_plan calls', async () => {
  const { ctx, events, chatJson } = setup();
  expect(chatJson).not.toHaveBeenCalled();
  await tool('propose_plan').run(
    { steps: planSteps(2), edges: planEdges(2) },
    ctx,
  );
  await tool('propose_plan').run(
    { steps: planSteps(2), edges: planEdges(2) },
    ctx,
  );
  const plans = events.filter((e) => e.type === 'plan') as Extract<AgentEvent, { type: 'plan' }>[];
  expect(plans).toHaveLength(2);
  expect(plans[0]!.ghosts.map((g) => g.id)).toEqual(plans[1]!.ghosts.map((g) => g.id));
});

test('ask_user validates 2-4 options and ends the turn on success', async () => {
  const { ctx, events } = setup();
  const bad = await tool('ask_user').run({ question: 'Which?', options: ['Only one'] }, ctx);
  expect(bad.result.startsWith('Problem:')).toBe(true);
  expect(bad.endTurn).toBeUndefined();
  expect(events.filter((e) => e.type === 'ask')).toHaveLength(0);

  const out = await tool('ask_user').run({ question: 'Which?', options: ['A', 'B', 'C'] }, ctx);
  expect(out.endTurn).toBe(true);
  const asks = events.filter((e) => e.type === 'ask') as Extract<AgentEvent, { type: 'ask' }>[];
  expect(asks).toHaveLength(1);
  expect(asks[0]).toEqual({ type: 'ask', question: 'Which?', options: ['A', 'B', 'C'] });
});

test('create_table reports the created list and columns', async () => {
  const { ctx } = setup();
  const out = await tool('create_table').run(
    {
      name: 'orders',
      label: 'Orders',
      columns: [
        { name: 'item', label: 'Item', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
      ],
      displayField: 'item',
    },
    ctx,
  );
  expect(out.result).toBe('Created list "Orders" with columns item, email.');
});

test('ops tools map 1:1 with by agent; failures become Problem results', async () => {
  const { ctx, bys, repo } = setup();
  const wfId = ctx.workflowId;

  const renamed = await tool('rename_workflow').run({ name: 'Renamed' }, ctx);
  expect(renamed.result.startsWith('Problem:')).toBe(false);
  expect(repo.getWorkflow(wfId)!.name).toBe('Renamed');

  const trigger = await tool('set_trigger').run(
    { type: 'trigger.gmailButton', config: { label: 'Go' } },
    ctx,
  );
  expect(trigger.result.startsWith('Problem:')).toBe(false);

  const added = await tool('add_step').run(
    {
      type: 'ai.write',
      title: 'Write reply',
      summary: 'Write a short reply.',
      config: { ...WRITE_CONFIG },
      inputs: { context: 'hi' },
      after: 'trigger',
    },
    ctx,
  );
  expect(added.result.startsWith('Problem:')).toBe(false);
  const stepId = repo.getWorkflow(wfId)!.steps[0]!.id;

  const updated = await tool('update_step').run({ stepId, title: 'Write warmer reply' }, ctx);
  expect(updated.result.startsWith('Problem:')).toBe(false);

  const connected = await tool('connect').run({ from: 'trigger', to: stepId }, ctx);
  // add_step with `after` already connected them: the op refuses, the tool reports.
  expect(connected.result.startsWith('Problem:')).toBe(true);

  const removed = await tool('remove_step').run({ stepId }, ctx);
  expect(removed.result.startsWith('Problem:')).toBe(false);

  const missing = await tool('remove_step').run({ stepId: 'nope' }, ctx);
  expect(missing.result.startsWith('Problem:')).toBe(true);
  expect(missing.endTurn).toBeUndefined();

  expect(bys.length).toBeGreaterThan(0);
  expect(bys.every((b) => b === 'agent')).toBe(true);
});

test('test_run emits the run id and returns one line per step', async () => {
  const { ctx, events, testRun } = setup();
  testRun.mockResolvedValueOnce({
    run: { id: 'run-1' },
    steps: [
      { stepId: 'trigger', status: 'done', why: 'Ran by hand.' },
      { stepId: 's1', status: 'done', why: 'Wrote a warm reply.' },
      { stepId: 's2', status: 'failed', error: 'No email found.' },
    ],
    usedSample: true,
  });
  // Titles resolve against the stored workflow.
  const wf = ctx.repo.getWorkflow(ctx.workflowId)!;
  ctx.repo.saveWorkflow({
    ...wf,
    steps: [
      ...wf.steps,
      {
        id: 's1',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Write.',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 's2',
        type: 'gmail.read',
        title: 'Read email',
        summary: 'Read.',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
  });
  const out = await tool('test_run').run({}, ctx);
  expect(testRun).toHaveBeenCalledWith(ctx.workflowId);
  const tests = events.filter((e) => e.type === 'test') as Extract<AgentEvent, { type: 'test' }>[];
  expect(tests).toEqual([{ type: 'test', runId: 'run-1' }]);
  const lines = out.result.split('\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('done');
  expect(lines[1]).toContain('Write reply');
  expect(lines[1]).toContain('Wrote a warm reply.');
  expect(lines[2]).toContain('failed');
  expect(lines[2]).toContain('No email found.');
});

test('activate turns the workflow on and emits done', async () => {
  const { ctx, events, repo, tables } = setup();
  void tables;
  // A trigger-only manual workflow has no problems, so it can turn on.
  const out = await tool('activate').run({}, ctx);
  expect(repo.getWorkflow(ctx.workflowId)!.status).toBe('on');
  expect(out.endTurn).toBeUndefined();
  expect(out.result.length).toBeGreaterThan(0);
  expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
});

test('activate reports a Problem and emits no done when the workflow cannot turn on', async () => {
  const { ctx, events } = setup();
  await tool('set_trigger').run({ type: 'trigger.gmailButton', config: { label: 'Go' } }, ctx);
  // An unconnected step is unreachable: checkWorkflow blocks setStatus('on').
  await tool('add_step').run(
    {
      type: 'ai.write',
      title: 'Write reply',
      summary: 'Write a short reply.',
      config: { ...WRITE_CONFIG },
      inputs: { context: 'hi' },
    },
    ctx,
  );
  const out = await tool('activate').run({}, ctx);
  expect(out.result.startsWith('Problem:')).toBe(true);
  expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
});

test('explain returns stored definitions and stories', async () => {
  const { ctx, repo } = setup();
  const wfId = ctx.workflowId;
  const step = await tool('explain').run({ about: 'step', id: 'trigger' }, ctx);
  expect(step.result).toContain('Manual trigger');

  const table = await tool('explain').run({ about: 'table', id: 'customers' }, ctx);
  expect(table.result).toContain('Customers');
  expect(table.result).toContain('email');

  const workflow = await tool('explain').run({ about: 'workflow', id: wfId }, ctx);
  expect(workflow.result).toContain('Test chore');

  // Stories narrate done non-trigger steps, so the run needs a real step.
  const withStep = repo.saveWorkflow({
    ...repo.getWorkflow(wfId)!,
    steps: [
      {
        id: 's1',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Write.',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [{ from: 'trigger', to: 's1' }],
  });
  const run = repo.createRun({
    workflowId: wfId,
    workflowVersion: withStep.version,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: 'sr-1',
    runId: run.id,
    stepId: 's1',
    status: 'done',
    output: { text: 'hi' },
    why: 'Wrote a warm reply.',
    startedAt: new Date().toISOString(),
  });
  const runOut = await tool('explain').run({ about: 'run', id: run.id }, ctx);
  expect(runOut.result).toContain('Wrote a warm reply.');

  const missing = await tool('explain').run({ about: 'step', id: 'nope' }, ctx);
  expect(missing.result.startsWith('Problem:')).toBe(true);
});

test('query_table returns rows as compact lines', async () => {
  const { ctx, tables } = setup();
  tables.insert('customers', { name: 'Priya', email: 'priya@acme.co' });
  tables.insert('customers', { name: 'Sam', email: 'sam@x.com' });
  const out = await tool('query_table').run({ table: 'customers', limit: 10 }, ctx);
  const lines = out.result.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('Priya');
  const filtered = await tool('query_table').run(
    { table: 'customers', where: { email: 'sam@x.com' } },
    ctx,
  );
  expect(filtered.result.split('\n')).toHaveLength(1);
  expect(filtered.result).toContain('Sam');
  const unknown = await tool('query_table').run({ table: 'nope' }, ctx);
  expect(unknown.result.startsWith('Problem:')).toBe(true);
});

test('query_table with an unknown where key returns a Problem instead of every row', async () => {
  const { ctx, tables } = setup();
  tables.insert('customers', { name: 'Priya', email: 'priya@acme.co' });
  const out = await tool('query_table').run(
    { table: 'customers', where: { emial: 'priya@acme.co' } },
    ctx,
  );
  expect(out.result).toBe('Problem: Unknown column: emial for table customers');
});

test('query_table with an operator-shaped where value returns a Problem', async () => {
  const { ctx, tables } = setup();
  tables.insert('customers', { name: 'Priya', email: 'priya@acme.co' });
  const out = await tool('query_table').run(
    { table: 'customers', where: { email: { $ne: 'sam@x.com' } } },
    ctx,
  );
  expect(out.result.startsWith('Problem: Invalid where value for column email')).toBe(true);
});

test('pin_view saves a pinned stat view and confirms in Dad words', async () => {
  const { ctx } = setup();
  const out = await tool('pin_view').run(
    {
      table: 'customers',
      kind: 'stat',
      title: 'New customers this week',
      config: { stat: { op: 'count', sinceDays: 7 } },
    },
    ctx,
  );
  expect(out.result).toBe('Pinned "New customers this week" to your home screen.');
  expect(ctx.views.list()).toEqual([
    expect.objectContaining({ table: 'customers', kind: 'stat', pinned: true }),
  ]);
});

test('pin_view on an unknown list returns a Problem and saves nothing', async () => {
  const { ctx } = setup();
  const out = await tool('pin_view').run(
    { table: 'nope', kind: 'stat', title: 'X', config: { stat: { op: 'count' } } },
    ctx,
  );
  expect(out.result).toBe('Problem: Unknown table: nope');
  expect(ctx.views.list()).toEqual([]);
});

test('query_runs finds runs whose story contains the text', async () => {
  const { ctx, repo } = setup();
  const wfId = ctx.workflowId;
  const withStep = repo.saveWorkflow({
    ...repo.getWorkflow(wfId)!,
    steps: [
      {
        id: 's1',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Write.',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [{ from: 'trigger', to: 's1' }],
  });
  const run = repo.createRun({
    workflowId: wfId,
    workflowVersion: withStep.version,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: 'sr-1',
    runId: run.id,
    stepId: 's1',
    status: 'done',
    output: { text: 'hi' },
    why: 'Wrote a warm reply.',
    startedAt: new Date().toISOString(),
  });
  const hit = await tool('query_runs').run({ contains: 'warm reply' }, ctx);
  expect(hit.result).toContain(run.id);
  const miss = await tool('query_runs').run({ contains: 'zzz-no-such-text' }, ctx);
  expect(miss.result).not.toContain(run.id);
});

test('system prompt contains every catalog description, the fixed voice and the flow 1 example', () => {
  const { repo, tables } = setup();
  const wf = Workflow.parse(flow1Seed);
  repo.saveWorkflow(wf);
  const stored = repo.getWorkflow('flow-1')!;
  const prompt = buildSystemPrompt({
    business: { name: 'Corner Bakery', what: 'A bakery', timezone: 'America/Chicago' },
    workflow: stored,
    problems: checkWorkflow(stored, tables),
    tables: tables.listTables(),
  });
  expect(prompt).toContain(
    'You help a small business owner turn a chore into a chore reducer. Running a business is hard; be warm, brief and encouraging. Use plain words. Never mention JSON, ids or step types.',
  );
  for (const def of Object.values(catalog)) {
    expect(prompt).toContain(def.description);
    expect(prompt).toContain(def.type);
  }
  expect(prompt).toContain(flow1Example);
  expect(prompt).toContain(flow2Example);
  expect(prompt).toContain('America/Chicago');
  expect(prompt).toContain('Corner Bakery');
});

test('system prompt shows problems and existing lists', () => {
  const { repo, tables } = setup();
  const wf = repo.getWorkflow(ctxWorkflowId(repo))!;
  const prompt = buildSystemPrompt({
    business: { timezone: 'America/Chicago' },
    workflow: wf,
    problems: [{ stepId: 'trigger', problem: 'Something is off.' }],
    tables: tables.listTables(),
  });
  expect(prompt).toContain('Something is off.');
  expect(prompt).toContain('Customers');
});

function ctxWorkflowId(repo: Repo): string {
  return repo.listWorkflows()[0]!.id;
}

test('table store and ops types flow into tools without casts', () => {
  const { tables, ops }: { tables: TableStore; ops: WorkflowOps } = setup();
  expect(tables.listTables()).toHaveLength(1);
  expect(typeof ops.addStep).toBe('function');
});

test('TANGLED_MESSAGE matches the spec byte-exact (pinned for the Task 5 loop)', () => {
  expect(TANGLED_MESSAGE).toBe("I've got a bit tangled. Can you tell me which part to focus on?");
});

test('system prompt states the tool-call cap and the exact tangled message', () => {
  const { repo, tables } = setup();
  const wf = repo.getWorkflow(ctxWorkflowId(repo))!;
  const prompt = buildSystemPrompt({
    business: { timezone: 'America/Chicago' },
    workflow: wf,
    problems: checkWorkflow(wf, tables),
    tables: tables.listTables(),
  });
  expect(prompt).toContain("I've got a bit tangled. Can you tell me which part to focus on?");
});

test('unexpected tool throw still returns Problem and is logged server-side', async () => {
  const { ctx } = setup();
  ctx.testRun = vi.fn().mockRejectedValueOnce(new Error('kaboom-unexpected'));
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const out = await tool('test_run').run({}, ctx);
    expect(out.result.startsWith('Problem:')).toBe(true);
    expect(out.result).toContain('kaboom-unexpected');
    expect(errSpy).toHaveBeenCalled();
  } finally {
    errSpy.mockRestore();
  }
});

test('propose_plan re-validates refined plans: dup keys, unknown types, dangling edges', async () => {
  const cases: [string, unknown, string][] = [
    [
      'duplicate keys',
      {
        steps: [
          { key: 'd', type: 'ai.write', title: 'One', summary: 'First.' },
          { key: 'd', type: 'ai.write', title: 'Two', summary: 'Second.' },
        ],
        edges: [],
      },
      'Two planned steps share the key "d".',
    ],
    [
      'unknown type',
      {
        steps: [{ key: 'x', type: 'nope.fake', title: 'Bogus', summary: 'Bogus.' }],
        edges: [],
      },
      'I don\'t know how to do "nope.fake" yet.',
    ],
    [
      'dangling edge',
      {
        steps: [{ key: 'a', type: 'ai.write', title: 'Only', summary: 'Only.' }],
        edges: [{ from: 'a', to: 'ghost', when: null }],
      },
      'Unknown step key in plan edges: "ghost".',
    ],
  ];
  for (const [name, refined, snippet] of cases) {
    const { ctx, events, chatJson } = setup();
    chatJson.mockResolvedValueOnce({ data: refined, model: 'muse-wonder-1.0' });
    const out = await tool('propose_plan').run(
      { steps: planSteps(7), edges: planEdges(7) },
      ctx,
    );
    expect(out.result.startsWith('Problem:'), name).toBe(true);
    expect(out.result, name).toContain(snippet);
    expect(events.filter((e) => e.type === 'plan'), name).toHaveLength(0);
  }
});

test('query_runs returns only runs for its own workflow', async () => {
  const { ctx, repo } = setup();
  const wfId = ctx.workflowId;
  const withStep = repo.saveWorkflow({
    ...repo.getWorkflow(wfId)!,
    steps: [
      {
        id: 's1',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Write.',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [{ from: 'trigger', to: 's1' }],
  });
  const ownRun = repo.createRun({
    workflowId: wfId,
    workflowVersion: withStep.version,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: 'sr-own',
    runId: ownRun.id,
    stepId: 's1',
    status: 'done',
    output: { text: 'hi' },
    why: 'Wrote a warm reply.',
    startedAt: new Date().toISOString(),
  });
  const other = repo.createWorkflow({ name: 'Other chore', description: 'Other.' });
  const otherRun = repo.createRun({
    workflowId: other.id,
    workflowVersion: other.version,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: 'sr-other',
    runId: otherRun.id,
    stepId: 'trigger',
    status: 'done',
    output: {},
    why: 'Other workflow ran.',
    startedAt: new Date().toISOString(),
  });
  const out = await tool('query_runs').run({}, ctx);
  expect(out.result).toContain(ownRun.id);
  expect(out.result).not.toContain(otherRun.id);
});

test('create_workflow creates a workflow, switches the target, and emits switched', async () => {
  const { ctx, events, repo } = setup();
  const before = ctx.workflowId;
  const out = await tool('create_workflow').run(
    { name: 'Photo posts', description: 'Turns product photos into Facebook posts.' },
    ctx,
  );
  expect(out.result.startsWith('Problem:')).toBe(false);
  const created = repo.getWorkflow(ctx.workflowId)!;
  expect(created.id).not.toBe(before);
  expect(created.name).toBe('Photo posts');
  const switched = events.filter((e) => e.type === 'switched');
  expect(switched).toEqual([{ type: 'switched', workflowId: created.id }]);
  expect(events.filter((e) => e.type === 'activity')).toHaveLength(1);
});

test('create_workflow without a name or description returns a Problem and switches nothing', async () => {
  const { ctx, events } = setup();
  const before = ctx.workflowId;
  for (const args of [{ description: 'No name.' }, { name: 'No description.' }, {}]) {
    const out = await tool('create_workflow').run(args, ctx);
    expect(out.result.startsWith('Problem:')).toBe(true);
  }
  expect(ctx.workflowId).toBe(before);
  expect(events.filter((e) => e.type === 'switched')).toEqual([]);
});

test('system prompt asks one question per call, max 3 per request', () => {
  const { repo, tables } = setup();
  const wf = repo.getWorkflow(ctxWorkflowId(repo))!;
  const prompt = buildSystemPrompt({
    business: { timezone: 'America/Chicago' },
    workflow: wf,
    problems: [],
    tables: tables.listTables(),
  });
  expect(prompt).not.toContain('3 questions at a time');
  expect(prompt).toContain('one question');
  expect(prompt).toContain('at most 3 questions per request');
});
