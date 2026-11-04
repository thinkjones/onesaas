import type { Run, TriggerMsg, Workflow } from '@onesaas/shared';
import { beforeEach, expect, vi } from 'vitest';
import type { Database } from '../src/db/connection.js';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import type { Gateway } from '../src/models/gateway.js';
import { registerEmailTrigger } from '../src/triggers/email.js';

const BOOKING_SUBJECT = 'Booking for Saturday evening';
const BOOKING_SNIPPET = 'Hi! Can I book a table for 4 this Saturday at 7pm? Thanks!';
// A full-body canary: triage must NEVER see it (subject + snippet only).
const BODY_CANARY = 'body-canary-9f3k-full-message-text';

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'flow-email',
    name: 'Email bookings',
    description: 'test workflow',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.email',
      title: 'New email',
      summary: 'Runs when a new customer email arrives.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [],
    edges: [],
    ...overrides,
  };
}

function makeEmail(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    threadId: 'thread-1',
    from: 'jordan@example.com',
    fromName: 'Jordan Lee',
    subject: BOOKING_SUBJECT,
    snippet: BOOKING_SNIPPET,
    ...overrides,
  };
}

function makeTrigger(payload: unknown): TriggerMsg {
  // The inbox watcher fans out: workflowId '*' means "every email workflow".
  return { type: 'trigger', workflowId: '*', triggerType: 'email', payload };
}

interface Harness {
  db: Database;
  repo: Repo;
  start: ReturnType<typeof vi.fn>;
  chatJson: ReturnType<typeof vi.fn>;
  fireTrigger: (t: TriggerMsg) => void;
}

function setup(workflows: Workflow[] = [makeWorkflow()], isCustomer = true): Harness {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  for (const wf of workflows) repo.saveWorkflow(wf);
  let triggerFn: ((t: TriggerMsg) => void) | null = null;
  const bridge = {
    onTrigger: (fn: (t: TriggerMsg) => void) => {
      triggerFn = fn;
    },
  };
  const start = vi.fn(async () => ({}) as Run);
  const engine = { start };
  const chatJson = vi.fn(async () => ({
    data: { isCustomer, why: 'It reads like a customer enquiry.' },
    model: 'muse-spark-1.3',
    tokens: { input: 1, output: 1 },
    costUsd: 0,
  }));
  const gateway = { chatJson } as unknown as Gateway;
  registerEmailTrigger({ bridge, engine, repo, gateway, db });
  return {
    db,
    repo,
    start,
    chatJson,
    fireTrigger: (t: TriggerMsg) => triggerFn?.(t),
  };
}

let h: Harness;

beforeEach(() => {
  h = setup();
  vi.clearAllMocks();
});

function seenCount(db: Database, threadId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM "seen_emails" WHERE "thread_id" = ?').get(threadId) as {
      n: number;
    }
  ).n;
}

test('the same threadId twice starts one run (seen_emails dedupe)', async () => {
  const email = makeEmail();
  h.fireTrigger(makeTrigger(email));
  await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
  h.fireTrigger(makeTrigger(email));
  // A heartbeat longer than the first pass: the duplicate must never start.
  await new Promise((r) => setTimeout(r, 50));
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.start).toHaveBeenCalledWith('flow-email', { email });
});

test('concurrent duplicates still start one run (INSERT OR IGNORE race safety)', async () => {
  const email = makeEmail();
  h.fireTrigger(makeTrigger(email));
  h.fireTrigger(makeTrigger(email));
  h.fireTrigger(makeTrigger(email));
  await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 50));
  expect(h.start).toHaveBeenCalledTimes(1);
});

test('triage returning isCustomer:false starts no run and keeps the dedupe row', async () => {
  const local = setup([makeWorkflow()], false);
  local.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-not-customer' })));
  await vi.waitFor(() => expect(local.chatJson).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 50));
  expect(local.start).not.toHaveBeenCalled();
  // A definitive verdict keeps the row: re-firing dedupes without re-triaging.
  expect(seenCount(local.db, 'thread-not-customer')).toBe(1);
  local.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-not-customer' })));
  await new Promise((r) => setTimeout(r, 50));
  expect(local.chatJson).toHaveBeenCalledTimes(1);
  expect(local.start).not.toHaveBeenCalled();
});

test('a triage exception surfaces on stderr and frees the thread for retry', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    h.chatJson.mockRejectedValueOnce(new Error('model down'));
    h.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-triage-bad' })));
    await vi.waitFor(() => expect(h.chatJson).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(seenCount(h.db, 'thread-triage-bad')).toBe(0));
    expect(errSpy).toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
    // A later reload retries the same thread and starts the run.
    h.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-triage-bad' })));
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
    expect(h.start).toHaveBeenCalledWith('flow-email', {
      email: makeEmail({ threadId: 'thread-triage-bad' }),
    });
  } finally {
    errSpy.mockRestore();
  }
});

test('triage runs on role triage with the {isCustomer, why} schema', async () => {
  h.fireTrigger(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(h.chatJson).toHaveBeenCalledTimes(1));
  const opts = h.chatJson.mock.calls[0]![0] as {
    role: string;
    schemaName: string;
    schema: { safeParse(v: unknown): { success: boolean } };
  };
  expect(opts.role).toBe('triage');
  expect(opts.schemaName).toBe('email_triage');
  expect(opts.schema.safeParse({ isCustomer: true, why: 'looks like a customer' }).success).toBe(true);
  expect(opts.schema.safeParse({}).success).toBe(false);
  expect(opts.schema.safeParse({ isCustomer: 'yes', why: 'x' }).success).toBe(false);
});

test('triage sees the subject and snippet only — never the full body', async () => {
  h.fireTrigger(makeTrigger(makeEmail({ body: BODY_CANARY })));
  await vi.waitFor(() => expect(h.chatJson).toHaveBeenCalledTimes(1));
  const opts = h.chatJson.mock.calls[0]![0] as { user: string };
  expect(opts.user).toContain(BOOKING_SUBJECT);
  expect(opts.user).toContain(BOOKING_SNIPPET);
  expect(opts.user).not.toContain(BODY_CANARY);
});

test('onlyCustomerEmails:false skips triage and starts the run', async () => {
  const local = setup([
    makeWorkflow({
      trigger: { ...makeWorkflow().trigger, config: { onlyCustomerEmails: false } },
    }),
  ]);
  local.fireTrigger(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(local.start).toHaveBeenCalledTimes(1));
  expect(local.chatJson).not.toHaveBeenCalled();
});

test('an empty config triages (onlyCustomerEmails defaults to true)', async () => {
  h.fireTrigger(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
  expect(h.chatJson).toHaveBeenCalledTimes(1);
});

test.each([
  ['subject match', { subject: 'Re: BOOKING question' }, true],
  ['snippet match', { snippet: 'is this booking still open?' }, true],
  ['no match anywhere', { subject: 'Hello', snippet: 'just saying hi' }, false],
])('matching %s', async (_name, emailOverrides, shouldStart) => {
  const local = setup([
    makeWorkflow({
      trigger: { ...makeWorkflow().trigger, config: { matching: 'booking' } },
    }),
  ]);
  const email = makeEmail({ threadId: `thread-${_name}`, ...emailOverrides });
  local.fireTrigger(makeTrigger(email));
  if (shouldStart) {
    await vi.waitFor(() => expect(local.start).toHaveBeenCalledTimes(1));
  } else {
    await vi.waitFor(() => expect(
      (local.db.prepare('SELECT COUNT(*) AS n FROM "seen_emails"').get() as { n: number }).n,
    ).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(local.start).not.toHaveBeenCalled();
    // A filtered-out email still triages nothing: matching runs first.
    expect(local.chatJson).not.toHaveBeenCalled();
  }
});

test('fans out to every ON email workflow', async () => {
  const second = makeWorkflow({ id: 'flow-email-2', name: 'Second' });
  const local = setup([makeWorkflow(), second]);
  local.fireTrigger(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(local.start).toHaveBeenCalledTimes(2));
  expect(local.start).toHaveBeenCalledWith('flow-email', { email: makeEmail() });
  expect(local.start).toHaveBeenCalledWith('flow-email-2', { email: makeEmail() });
});

test('off workflows and non-email triggers are skipped', async () => {
  const off = makeWorkflow({ id: 'flow-off', trigger: { ...makeWorkflow().trigger, config: {} }, status: 'off' });
  const manual = makeWorkflow({
    id: 'flow-manual',
    trigger: { ...makeWorkflow().trigger, type: 'trigger.manual', config: {} },
  });
  const local = setup([makeWorkflow(), off, manual]);
  local.fireTrigger(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(local.start).toHaveBeenCalledTimes(1));
  expect(local.start).toHaveBeenCalledWith('flow-email', expect.anything());
});

test('a gmailButton trigger message is ignored', async () => {
  h.fireTrigger({ type: 'trigger', workflowId: '*', triggerType: 'gmailButton', payload: makeEmail() });
  await new Promise((r) => setTimeout(r, 50));
  expect(h.start).not.toHaveBeenCalled();
  expect(h.chatJson).not.toHaveBeenCalled();
});

test('a rejected start logs the error, frees the thread for retry, and does not break later emails', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    h.start.mockRejectedValueOnce(new Error('infra down'));
    h.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-bad' })));
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(1));
    // Surfaced on stderr, not swallowed silent...
    expect(errSpy).toHaveBeenCalled();
    // ...and the dedupe row is removed so a reload retries the thread.
    await vi.waitFor(() => expect(seenCount(h.db, 'thread-bad')).toBe(0));
    h.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-bad' })));
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(2));
    expect(h.start).toHaveBeenNthCalledWith(2, 'flow-email', {
      email: makeEmail({ threadId: 'thread-bad' }),
    });
    // Later emails still flow.
    h.fireTrigger(makeTrigger(makeEmail({ threadId: 'thread-good' })));
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(3));
  } finally {
    errSpy.mockRestore();
  }
});

test('an old DB without seen_emails gains the table and the trigger works', async () => {
  // Legacy shape: repo DDL minus the seen_emails table.
  const db = openDb(':memory:');
  db.exec(`
    CREATE TABLE "workflows" ("id" TEXT NOT NULL, "version" INTEGER NOT NULL, "def" TEXT NOT NULL, "status" TEXT NOT NULL, "created_at" TEXT NOT NULL, PRIMARY KEY ("id", "version"));
    CREATE TABLE "runs" ("id" TEXT NOT NULL PRIMARY KEY, "workflow_id" TEXT NOT NULL, "workflow_version" INTEGER NOT NULL, "trigger_payload" TEXT, "status" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'live', "used_sample" INTEGER NOT NULL DEFAULT 0, "started_at" TEXT NOT NULL, "ended_at" TEXT);
    CREATE TABLE "step_runs" ("id" TEXT NOT NULL PRIMARY KEY, "run_id" TEXT NOT NULL, "step_id" TEXT NOT NULL, "status" TEXT NOT NULL, "input" TEXT, "output" TEXT, "error" TEXT, "model" TEXT, "tokens" TEXT, "cost_usd" REAL, "duration_ms" INTEGER, "why" TEXT, "started_at" TEXT NOT NULL);
  `);
  const repo = createRepo(db);
  repo.saveWorkflow(makeWorkflow());
  const cols = db.prepare(`PRAGMA table_info("seen_emails")`).all() as { name: string }[];
  expect(cols.map((c) => c.name).sort()).toEqual(['seen_at', 'thread_id']);

  let triggerFn: ((t: TriggerMsg) => void) | null = null;
  const start = vi.fn(async () => ({}) as Run);
  const chatJson = vi.fn(async () => ({
    data: { isCustomer: true, why: 'customer' },
    model: 'm',
    tokens: { input: 0, output: 0 },
    costUsd: 0,
  }));
  registerEmailTrigger({
    bridge: { onTrigger: (fn) => { triggerFn = fn; } },
    engine: { start },
    repo,
    gateway: { chatJson } as unknown as Gateway,
    db,
  });
  triggerFn!(makeTrigger(makeEmail()));
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
});
