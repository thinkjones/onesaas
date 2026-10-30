import { vi } from 'vitest';
import { Workflow, catalog } from '@dad/shared';
import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { buildRunStory } from '../src/engine/story.js';
import { createTestRunner } from '../src/engine/testRun.js';
import { createGateway } from '../src/models/gateway.js';
import flow1Seed from '../src/seed/flow1.json' with { type: 'json' };
import { executors } from '../src/steps/registry.js';
import { createTableStore } from '../src/tables/store.js';

const SAMPLE_PREFIX = 'Tested with a sample email because none was open in Gmail.';

function completion(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

// Flow 1 calls the model twice: extract, then write. Fixed responses keep the
// run deterministic; the extract output keys the customers table by email.
function gatewayWithFlow1Responses() {
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      completion(
        JSON.stringify({
          output: {
            name: 'Priya Nair',
            email: 'priya@acme.co',
            need: 'weekend catering',
            urgency: 'normal',
          },
          why: 'I read the details out of the email.',
        }),
      ),
    )
    .mockResolvedValueOnce(
      completion(
        JSON.stringify({
          output: { text: 'Hi Priya, thanks for writing — we do cater weekends!' },
          why: 'I wrote a warm reply.',
        }),
      ),
    );
  const gateway = createGateway({ client: { chat: { completions: { create } } } as never });
  return { create, gateway };
}

function setup(bridgeCall: (...args: any[]) => Promise<unknown>) {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  const repo = createRepo(db);
  repo.saveWorkflow(Workflow.parse(flow1Seed));
  // Same shape as the main.ts customers seed (flow 1 keys by email).
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
  const { gateway } = gatewayWithFlow1Responses();
  const call = vi.fn(bridgeCall);
  const { testRun } = createTestRunner({
    repo,
    executors,
    ctx: { gateway, tables, bridge: { call } },
  });
  return { repo, tables, call, testRun };
}

const disconnected = () =>
  setup(() => Promise.reject(new Error('I need Gmail open in Chrome to do this.')));

test('act/store executors expose a preview alongside run', () => {
  expect(typeof executors['gmail.draftReply']!.preview).toBe('function');
  expect(typeof executors['table.upsert']!.preview).toBe('function');
  expect(typeof executors['approval.ask']!.preview).toBe('function');
});

test('test run with a disconnected bridge uses the sample and previews every outside action', async () => {
  const { repo, tables, call, testRun } = disconnected();

  const { run, steps, usedSample } = await testRun('flow-1');

  expect(usedSample).toBe(true);
  expect(run.kind).toBe('test');
  expect(run.status).toBe('done');
  expect(steps.map((s) => [s.stepId, s.status])).toEqual([
    ['trigger', 'done'],
    ['extract', 'done'],
    ['save', 'done'],
    ['write', 'done'],
    ['approve', 'done'],
    ['draft', 'done'],
  ]);

  const byId = new Map(steps.map((s) => [s.stepId, s]));
  // The trigger ran on the catalog sample: extract saw Priya's email.
  expect(byId.get('trigger')!.output).toEqual(catalog['trigger.gmailButton']!.sample);
  expect(byId.get('extract')!.input).toEqual({
    text: 'From Priya Nair <priya@acme.co>\nSubject: Do you cater weekend events?\n\nHi! We loved your stall at the market. Do you cater small weekend events?',
  });
  // Approval auto-approved: no waiting state left behind.
  expect(byId.get('approve')!.output).toEqual({
    text: 'Hi Priya, thanks for writing — we do cater weekends!',
    decision: 'approved',
  });
  expect(byId.get('approve')!.why).toBe("In a real run I'd ask you to check this first.");
  // Save preview read the (empty) store: would-create wording, id 0 (no row).
  expect(byId.get('save')!.output).toEqual({ id: 0, created: true });
  expect(byId.get('save')!.why).toBe(
    'In a real run I would save Priya Nair to customers because the email address is new.',
  );
  expect(byId.get('draft')!.output).toEqual({ drafted: true });
  expect(byId.get('draft')!.why).toBe(
    'In a real run I would put this reply into Gmail as a draft.',
  );

  // The bridge was only asked for the open email (which failed); Gmail was
  // never touched for real, and the customers table is still empty.
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('gmail', 'readOpenEmail', {}, 5000);
  expect(tables.query('customers')).toEqual([]);

  // Test runs are hidden from history by default.
  expect(repo.listRuns()).toEqual([]);
  const withTests = repo.listRuns({ includeTests: true });
  expect(withTests.map((r) => r.id)).toEqual([run.id]);
  expect(repo.getRun(run.id)!.run.kind).toBe('test');
});

test('test run with an open email uses it and extract sees that email', async () => {
  const liveEmail = {
    from: 'sam@x.com',
    fromName: 'Sam Okafor',
    subject: 'Big order',
    body: 'We need 200 cupcakes for Saturday.',
    threadId: 'thread_live_1',
  };
  const { call, testRun } = setup(() => Promise.resolve(liveEmail));

  const { run, steps, usedSample } = await testRun('flow-1');

  expect(usedSample).toBe(false);
  expect(run.kind).toBe('test');
  expect(run.status).toBe('done');
  expect(steps.every((s) => s.status === 'done')).toBe(true);
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  expect(byId.get('trigger')!.output).toEqual({ email: liveEmail });
  expect(byId.get('extract')!.input).toEqual({
    text: 'From Sam Okafor <sam@x.com>\nSubject: Big order\n\nWe need 200 cupcakes for Saturday.',
  });
  const actions = call.mock.calls.map((c) => c[1]);
  expect(actions).toEqual(['readOpenEmail']);
});

test('test run save preview reports an update when the email is already known', async () => {
  const { tables, testRun } = disconnected();
  const seeded = tables.insert('customers', {
    name: 'Priya Nair',
    email: 'priya@acme.co',
    need: 'old need',
    urgency: 'low',
  });

  const { steps, usedSample } = await testRun('flow-1');

  expect(usedSample).toBe(true);
  const save = steps.find((s) => s.stepId === 'save')!;
  expect(save.status).toBe('done');
  expect(save.output).toEqual({ id: seeded.id, created: false });
  expect(save.why).toBe(
    'In a real run I would update Priya Nair in customers because we already know this email address.',
  );
  // The preview read but did not write: still exactly the seeded row.
  expect(tables.query('customers')).toHaveLength(1);
});

test('a hanging bridge call falls back to the sample after 5 s', async () => {
  vi.useFakeTimers();
  try {
    const { testRun } = setup(() => new Promise(() => {}));
    const pending = testRun('flow-1');
    await vi.advanceTimersByTimeAsync(5000);
    const { run, steps, usedSample } = await pending;
    expect(usedSample).toBe(true);
    expect(run.status).toBe('done');
    expect(steps.every((s) => s.status === 'done')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('a test-run story that used the sample starts with the sample prefix', async () => {
  const { testRun } = disconnected();
  const { steps, usedSample } = await testRun('flow-1');
  expect(usedSample).toBe(true);

  const wf = Workflow.parse(flow1Seed);
  const sampled = buildRunStory(wf, steps, { usedSample: true });
  expect(sampled[0]).toBe(SAMPLE_PREFIX);
  const live = buildRunStory(wf, steps, { usedSample: false });
  expect(live[0]!.startsWith('Runs when you click the button in Gmail.')).toBe(true);
  // No options: unchanged legacy behavior.
  expect(buildRunStory(wf, steps)).toEqual(live);
});

test('testRun throws for an unknown workflow', async () => {
  const { testRun } = disconnected();
  await expect(testRun('nope')).rejects.toThrow('Unknown workflow: nope');
});

// A trigger-only workflow: just the trigger step, no edges.
function triggerOnlyWorkflow(id: string, type: string) {
  return Workflow.parse({
    id,
    name: id,
    description: id,
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type,
      title: 'Trigger',
      summary: 'Runs by hand.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [],
    edges: [],
  });
}

test('a manual-trigger test run reports usedSample=false and no sample prefix', async () => {
  const { repo, testRun } = disconnected();
  const wf = triggerOnlyWorkflow('manual-1', 'trigger.manual');
  repo.saveWorkflow(wf);

  const { run, steps, usedSample } = await testRun('manual-1');

  expect(usedSample).toBe(false);
  expect(run.status).toBe('done');
  expect(steps.map((s) => [s.stepId, s.status])).toEqual([['trigger', 'done']]);
  const story = buildRunStory(wf, steps, { usedSample });
  expect(story[0]).not.toBe(SAMPLE_PREFIX);
  expect(story).toEqual(['Runs by hand.']);
});

test('a trigger.email test run falls back to the booking sample', async () => {
  const { repo, testRun } = disconnected();
  repo.saveWorkflow(triggerOnlyWorkflow('email-1', 'trigger.email'));
  const { run, steps, usedSample } = await testRun('email-1');
  expect(usedSample).toBe(true);
  expect(run.status).toBe('done');
  expect(run.triggerPayload).toEqual(catalog['trigger.email']!.sample);
  expect(steps.map((s) => [s.stepId, s.status])).toEqual([['trigger', 'done']]);
});

test('testRun fails fast when a non-email trigger type has no sample', async () => {
  const { repo, testRun } = disconnected();
  repo.saveWorkflow(triggerOnlyWorkflow('sched-1', 'trigger.smokeSignal'));
  await expect(testRun('sched-1')).rejects.toThrow(
    'No sample for trigger type: trigger.smokeSignal',
  );
});

test('a pre-kind runs table migrates in place with old runs staying live', () => {
  const db = openDb(':memory:');
  // An old app.db: the runs table as created before `kind` existed.
  db.exec(
    `CREATE TABLE "runs" ("id" TEXT NOT NULL PRIMARY KEY, "workflow_id" TEXT NOT NULL, "workflow_version" INTEGER NOT NULL, "trigger_payload" TEXT, "status" TEXT NOT NULL, "started_at" TEXT NOT NULL, "ended_at" TEXT)`,
  );
  db.prepare(
    `INSERT INTO "runs" ("id", "workflow_id", "workflow_version", "trigger_payload", "status", "started_at", "ended_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('run-old', 'flow-1', 1, '{"a":1}', 'done', new Date().toISOString(), null);
  const repo = createRepo(db);
  const runs = repo.listRuns();
  expect(runs).toHaveLength(1);
  expect(runs[0]!.kind).toBe('live');
});
