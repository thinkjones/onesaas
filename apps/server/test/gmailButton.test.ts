import { EventEmitter } from 'node:events';
import type { Run, ServerToExtension, TriggerMsg, Workflow } from '@dad/shared';
import { beforeEach, expect, vi } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { registerGmailButtonTrigger } from '../src/triggers/gmailButton.js';

const LABEL = '✨ Save as lead & reply';

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'flow-1',
    name: 'Save as lead & reply',
    description: 'test workflow',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.gmailButton',
      title: 'Gmail button',
      summary: 'Runs when you click the button in Gmail.',
      config: { label: LABEL },
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [
      {
        id: 'step-1',
        type: 'test.step',
        title: 'Step one',
        summary: 'test step',
        config: {},
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [{ from: 'trigger', to: 'step-1' }],
    ...overrides,
  };
}

function makeEmail(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    from: 'amy@example.com',
    fromName: 'Amy',
    subject: 'Need help',
    body: 'Please call me.',
    threadId: 'thread-1',
    ...overrides,
  };
}

function makeTrigger(workflowId: string, payload: unknown): TriggerMsg {
  return { type: 'trigger', workflowId, triggerType: 'gmailButton', payload };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  repo: Repo;
  send: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  events: EventEmitter;
  fireReady: () => void;
  fireTrigger: (t: TriggerMsg) => void;
}

function setup(workflows: Workflow[] = [makeWorkflow()]): Harness {
  const repo = createRepo(openDb(':memory:'));
  for (const wf of workflows) repo.saveWorkflow(wf);
  const send = vi.fn();
  let readyFn: (() => void) | null = null;
  let triggerFn: ((t: TriggerMsg) => void) | null = null;
  const bridge = {
    send: (msg: ServerToExtension) => send(msg),
    onTrigger: (fn: (t: TriggerMsg) => void) => {
      triggerFn = fn;
    },
    onReady: (fn: () => void) => {
      readyFn = fn;
    },
  };
  const start = vi.fn();
  const events = new EventEmitter();
  const engine = { start, events };
  registerGmailButtonTrigger({ bridge, engine, repo });
  return {
    repo,
    send,
    start,
    events,
    fireReady: () => readyFn?.(),
    fireTrigger: (t: TriggerMsg) => triggerFn?.(t),
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

let h: Harness;

beforeEach(() => {
  h = setup();
  vi.clearAllMocks();
});

test('on ready, the bridge receives buttons with the flow-1 label', () => {
  h.fireReady();
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledWith({
    type: 'buttons',
    items: [{ workflowId: 'flow-1', label: LABEL }],
  });
});

test('two clicks for the same thread while the first run is pending start one run', () => {
  const d = deferred<Run>();
  h.start.mockReturnValue(d.promise);
  const email = makeEmail();
  h.fireTrigger(makeTrigger('flow-1', email));
  h.fireTrigger(makeTrigger('flow-1', email));
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.start).toHaveBeenCalledWith('flow-1', { email });
  d.resolve({} as Run);
});

test('after the first run finishes, a new click starts a new run', async () => {
  const first = deferred<Run>();
  h.start.mockReturnValueOnce(first.promise);
  const email = makeEmail();
  h.fireTrigger(makeTrigger('flow-1', email));
  expect(h.start).toHaveBeenCalledTimes(1);
  first.resolve({} as Run);
  await first.promise;
  await flush();
  const second = deferred<Run>();
  h.start.mockReturnValueOnce(second.promise);
  h.fireTrigger(makeTrigger('flow-1', email));
  expect(h.start).toHaveBeenCalledTimes(2);
  second.resolve({} as Run);
  await second.promise.catch(() => {});
});

test('a click for an unknown workflow is ignored', () => {
  h.fireTrigger(makeTrigger('nope', makeEmail()));
  expect(h.start).not.toHaveBeenCalled();
});

test('a click for an off workflow is ignored', () => {
  h.repo.saveWorkflow(makeWorkflow({ status: 'off' }));
  h.fireTrigger(makeTrigger('flow-1', makeEmail()));
  expect(h.start).not.toHaveBeenCalled();
});

test('a click for a non-gmailButton-trigger workflow is ignored', () => {
  h.repo.saveWorkflow(
    makeWorkflow({
      trigger: { ...makeWorkflow().trigger, type: 'trigger.manual', config: {} },
    }),
  );
  h.fireTrigger(makeTrigger('flow-1', makeEmail()));
  expect(h.start).not.toHaveBeenCalled();
});

test('a malformed payload (missing threadId) still calls start; the engine validates', () => {
  const d = deferred<Run>();
  h.start.mockReturnValue(d.promise);
  const { threadId: _dropped, ...rest } = makeEmail();
  h.fireTrigger(makeTrigger('flow-1', rest));
  expect(h.start).toHaveBeenCalledTimes(1);
  d.resolve({} as Run);
});

test('a run event is forwarded as runStatus with the threadId', () => {
  const run = h.repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: { email: { threadId: 'thread-1' } },
    status: 'running',
  });
  h.events.emit('event', { type: 'run', run });
  expect(h.send).toHaveBeenCalledWith({
    type: 'runStatus',
    workflowId: 'flow-1',
    threadId: 'thread-1',
    runId: run.id,
    status: 'running',
  });
});

test('buttons exclude off workflows', () => {
  const off: Workflow = {
    ...makeWorkflow(),
    id: 'flow-off',
    trigger: { ...makeWorkflow().trigger, config: { label: 'Off button' } },
    status: 'off',
  };
  h.repo.saveWorkflow(off);
  h.fireReady();
  expect(h.send).toHaveBeenCalledWith({
    type: 'buttons',
    items: [{ workflowId: 'flow-1', label: LABEL }],
  });
});
