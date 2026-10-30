import { EventEmitter } from 'node:events';
import { catalog } from '@dad/shared';
import { vi } from 'vitest';
import { createConversationStore } from '../src/agent/conversations.js';
import { AgentBusyError, createBuilderAgent } from '../src/agent/loop.js';
import { TANGLED_MESSAGE, TOOL_CALL_CAP } from '../src/agent/prompt.js';
import type { AgentEvent } from '../src/agent/tools.js';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { createEngine } from '../src/engine/engine.js';
import { createServer } from '../src/main.js';
import type { ChatToolsOptions, ChatToolsResult, Gateway } from '../src/models/gateway.js';
import { executors } from '../src/steps/registry.js';
import { createTableStore } from '../src/tables/store.js';
import { createWorkflowOps } from '../src/workflows/ops.js';

// A scripted model response: assistant text and/or tool calls. A thunk form
// lets later responses read repo state written by earlier tool calls (ids the
// script cannot know upfront, e.g. for `connect` after `add_step`).
type ScriptedCall = { name: string; args?: unknown; argsError?: string };
type ScriptedResponse = { text?: string | null; calls?: ScriptedCall[] };
type ScriptStep = ScriptedResponse | (() => ScriptedResponse);

function scriptedGateway(script: ScriptStep[]): { gateway: Gateway; calls: ChatToolsOptions[] } {
  const calls: ChatToolsOptions[] = [];
  let i = 0;
  const gateway: Gateway = {
    chatJson: async () => {
      throw new Error('chatJson not scripted');
    },
    chatTools: async (o: ChatToolsOptions): Promise<ChatToolsResult> => {
      calls.push(o);
      const raw = script[i];
      i += 1;
      if (!raw) throw new Error('script exhausted');
      const step = typeof raw === 'function' ? raw() : raw;
      const toolCalls = (step.calls ?? []).map((c, n) => ({
        id: `call_${i}_${n}`,
        name: c.name,
        args: c.args,
        ...(c.argsError ? { argsError: c.argsError } : {}),
      }));
      return {
        message: {
          role: 'assistant',
          content: step.text ?? null,
          refusal: null,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args ?? null) },
                })),
              }
            : {}),
        } as never,
        toolCalls,
        model: 'test-model',
        tokens: { input: 1, output: 1 },
        costUsd: 0,
      };
    },
  };
  return { gateway, calls };
}

function setup(script: ScriptStep[] = [{ text: 'ok' }]) {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  const repo = createRepo(db);
  const conversations = createConversationStore(db);
  const agentEvents = new EventEmitter();
  const seen: { type: string; workflowId: string; event: AgentEvent }[] = [];
  agentEvents.on('event', (e) => seen.push(e));
  const { gateway, calls } = scriptedGateway(script);
  const testRun = vi.fn();
  // Same wiring as main.ts: Dad's ops notify the agent, the agent's own ops
  // must not self-notify.
  let agent!: ReturnType<typeof createBuilderAgent>;
  const ops = createWorkflowOps({
    repo,
    tables,
    catalog,
    onChange: (wf, note, by) => {
      if (by === 'dad') agent.noteManualChange(wf.id, note);
    },
  });
  agent = createBuilderAgent({
    gateway,
    ops,
    tables,
    repo,
    engine: {} as never,
    events: agentEvents,
    conversations,
    testRun,
  });
  const wf = ops.create({ name: 'Test chore', description: 'A test.' });
  return { db, tables, repo, conversations, ops, agent, agentEvents, seen, calls, testRun, wf, gateway };
}

function setupApp(script: ScriptStep[] = [{ text: 'ok' }]) {
  const s = setup(script);
  const engine = createEngine({
    repo: s.repo,
    executors,
    ctx: {
      gateway: s.gateway,
      tables: s.tables,
      bridge: {
        call: async () => {
          throw new Error('no bridge');
        },
      },
    },
  });
  const app = createApp({
    repo: s.repo,
    tables: s.tables,
    ops: s.ops,
    agent: s.agent,
    agentEvents: s.agentEvents,
    engine,
  });
  return { ...s, app, engine };
}

async function postJson(
  app: ReturnType<typeof createApp>,
  url: string,
  body?: unknown,
): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const WRITE_ARGS = {
  type: 'ai.write',
  title: 'Write reply',
  summary: 'Write a short reply.',
  config: { instructions: 'Write a short reply.', tone: 'friendly' },
  inputs: { context: 'hello' },
};

test('a propose_plan turn ends with a plan event and done', async () => {
  const { agent, seen, calls, conversations, wf } = setup([
    {
      calls: [
        {
          name: 'propose_plan',
          args: {
            steps: [{ key: 'read', type: 'ai.extract', title: 'Read it', summary: 'Read the email.' }],
            edges: [],
          },
        },
      ],
    },
  ]);
  await agent.send(wf.id, 'When a customer emails me, help me reply.');
  // EndTurn tool: the model is not called again.
  expect(calls).toHaveLength(1);
  expect(calls[0]!.role).toBe('builder');
  const kinds = seen.map((s) => s.event.type);
  expect(kinds).toContain('plan');
  expect(kinds[kinds.length - 1]).toBe('done');
  const plan = seen.map((s) => s.event).find((e) => e.type === 'plan');
  expect(plan).toMatchObject({
    type: 'plan',
    ghosts: [{ id: 'ghost-read', type: 'ai.extract', title: 'Read it' }],
    edges: [],
  });
  // The SSE envelope shape.
  for (const s of seen) expect(s).toMatchObject({ type: 'agent', workflowId: wf.id });
  // Persisted history: user + assistant + tool result.
  const conv = conversations.load(wf.id)!;
  expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(conv.transcript).toEqual([
    { role: 'dad', text: 'When a customer emails me, help me reply.', at: expect.any(Number) },
  ]);
});

test('next turn builds four steps, connects and says one line', async () => {
  let t!: ReturnType<typeof setup>;
  t = setup([
    {
      calls: [
        {
          name: 'propose_plan',
          args: {
            steps: [{ key: 'w', type: 'ai.write', title: 'Write', summary: 'Write.' }],
            edges: [],
          },
        },
      ],
    },
    {
      calls: ['One', 'Two', 'Three', 'Four'].map((n) => ({
        name: 'add_step',
        args: { ...WRITE_ARGS, title: `Write ${n}` },
      })),
    },
    () => {
      const steps = t.repo.getWorkflow(t.wf.id)!.steps;
      return { calls: [{ name: 'connect', args: { from: 'trigger', to: steps[0]!.id } }] };
    },
    { text: 'All built!' },
  ]);
  const { agent, seen, calls, wf } = t;
  await agent.send(wf.id, 'plan please');
  await agent.send(wf.id, 'yes');
  expect(calls).toHaveLength(4);
  expect(seen.filter((s) => s.event.type === 'built')).toHaveLength(4);
  const says = seen.filter((s) => s.event.type === 'say');
  expect(says).toHaveLength(1);
  expect(says[0]!.event).toEqual({ type: 'say', text: 'All built!' });
  // Turn 2's first model call saw turn 1's persisted history.
  const turn2First = calls[1]!.messages;
  expect(turn2First.filter((m) => m.role === 'user')).toHaveLength(2);
  expect(agent.getTranscript(wf.id).map((e) => e.role)).toEqual(['dad', 'dad', 'agent']);
});

test('an unknown tool becomes a Problem result and the loop continues', async () => {
  const { agent, calls, seen, wf } = setup([
    { calls: [{ name: 'teleport', args: { where: 'x' } }] },
    { text: 'Never mind.' },
  ]);
  await agent.send(wf.id, 'go');
  expect(calls).toHaveLength(2);
  const tools = calls[1]!.messages.filter((m) => m.role === 'tool') as unknown as {
    content: string;
  }[];
  expect(tools).toHaveLength(1);
  expect(tools[0]!.content).toBe('Problem: there is no tool called teleport.');
  expect(seen.map((s) => s.event.type)).toContain('say');
  expect(seen[seen.length - 1]!.event).toEqual({ type: 'done' });
});

test('an argsError becomes a Problem result and the loop continues', async () => {
  const { agent, calls, seen, wf } = setup([
    { calls: [{ name: 'add_step', argsError: "Arguments weren't valid JSON: boom" }] },
    { text: 'ok then' },
  ]);
  await agent.send(wf.id, 'go');
  expect(calls).toHaveLength(2);
  const tools = calls[1]!.messages.filter((m) => m.role === 'tool') as unknown as {
    content: string;
  }[];
  expect(tools.map((t) => t.content)).toEqual(["Problem: Arguments weren't valid JSON: boom"]);
  expect(seen[seen.length - 1]!.event).toEqual({ type: 'done' });
});

test('the 21st call is not executed and the tangled message is said', async () => {
  expect(TOOL_CALL_CAP).toBe(20);
  const { agent, calls, seen, conversations, wf } = setup([
    { calls: Array.from({ length: 21 }, () => ({ name: 'add_step', args: { ...WRITE_ARGS } })) },
  ]);
  await agent.send(wf.id, 'build lots');
  expect(calls).toHaveLength(1);
  expect(seen.filter((s) => s.event.type === 'built')).toHaveLength(20);
  const says = seen.filter((s) => s.event.type === 'say');
  expect(says).toHaveLength(1);
  expect(says[0]!.event).toEqual({ type: 'say', text: TANGLED_MESSAGE });
  expect(seen[seen.length - 1]!.event).toEqual({ type: 'done' });
  // Every assistant tool_call still gets a tool result (the 21st a not-run
  // note) so the persisted history stays valid for the next model call.
  const conv = conversations.load(wf.id)!;
  const tools = conv.messages.filter((m) => m.role === 'tool') as unknown as {
    content: string;
  }[];
  expect(tools).toHaveLength(21);
  expect(tools[20]!.content.startsWith('Problem:')).toBe(true);
  expect(conv.messages[conv.messages.length - 1]).toMatchObject({
    role: 'assistant',
    content: TANGLED_MESSAGE,
  });
});

test('noteManualChange inserts a system message seen by the next chatTools call', async () => {
  const { agent, calls, conversations, wf, db } = setup([{ text: 'hi' }]);
  agent.noteManualChange(wf.id, 'Moved "Write reply".');
  // Persisted immediately: a fresh store on the same db sees it.
  const reopened = createConversationStore(db);
  expect(reopened.load(wf.id)!.messages).toEqual([
    { role: 'system', content: 'Dad changed the canvas: Moved "Write reply".' },
  ]);
  expect(conversations.load(wf.id)!.transcript).toEqual([]);
  await agent.send(wf.id, 'hi');
  const systems = calls[0]!.messages.filter((m) => m.role === 'system');
  expect(systems).toHaveLength(2);
  expect(systems[1]).toEqual({
    role: 'system',
    content: 'Dad changed the canvas: Moved "Write reply".',
  });
});

test('a mid-turn noteManualChange lands in the live conversation and the next model call', async () => {
  const s = setup([]);
  const resolvers: ((v: ChatToolsResult) => void)[] = [];
  let n = 0;
  const result = (message: object, toolCalls: ChatToolsResult['toolCalls']): ChatToolsResult =>
    ({ message, toolCalls, model: 'test-model', tokens: { input: 0, output: 0 }, costUsd: 0 }) as never;
  // Unknown tool: no side effects, just a Problem result so the loop continues.
  const tool = (id: string): ChatToolsResult =>
    result(
      {
        role: 'assistant',
        content: null,
        refusal: null,
        tool_calls: [{ id, type: 'function', function: { name: 'teleport', arguments: '{}' } }],
      },
      [{ id, name: 'teleport', args: {} }],
    );
  const gated: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: (o: ChatToolsOptions) => {
      s.calls.push(o);
      n += 1;
      // First response returns a tool call immediately; later calls wait on the gate.
      if (n === 1) return Promise.resolve(tool('call_1'));
      return new Promise<ChatToolsResult>((resolve) => resolvers.push(resolve));
    },
  };
  const agent = createBuilderAgent({
    gateway: gated,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  const turn = agent.send(s.wf.id, 'go');
  const waitForCalls = async (count: number): Promise<void> => {
    const deadline = Date.now() + 2000;
    while (s.calls.length < count) {
      if (Date.now() > deadline) throw new Error(`model call ${count} never started`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  await waitForCalls(2);
  // The turn is genuinely in flight: busy, with the second model call awaiting the gate.
  expect(agent.isBusy(s.wf.id)).toBe(true);
  agent.noteManualChange(s.wf.id, 'Moved "Write reply" mid-turn.');
  const note = 'Dad changed the canvas: Moved "Write reply" mid-turn.';
  // The second call's snapshot was taken before the note, so it must NOT see it...
  expect(
    s.calls[1]!.messages.some((m) => (m as { content?: unknown }).content === note),
  ).toBe(false);
  resolvers.splice(0).forEach((r) => r(tool('call_2')));
  await waitForCalls(3);
  resolvers.splice(0).forEach((r) =>
    r(result({ role: 'assistant', content: 'done', refusal: null }, [])),
  );
  await turn;
  expect(s.calls).toHaveLength(3);
  // ...but the NEXT model call (and the persisted history) must.
  expect(s.calls[2]!.messages).toContainEqual({ role: 'system', content: note });
  const reopened = createConversationStore(s.db);
  expect(reopened.load(s.wf.id)!.messages).toContainEqual({ role: 'system', content: note });
});

test('the system prompt rebuilds from the latest workflow on every iteration', async () => {
  const { agent, calls, wf } = setup([
    { calls: [{ name: 'rename_workflow', args: { name: 'Renamed by agent' } }] },
    { text: 'done' },
  ]);
  await agent.send(wf.id, 'rename it');
  expect(calls).toHaveLength(2);
  const sys0 = calls[0]!.messages[0] as unknown as { content: string };
  const sys1 = calls[1]!.messages[0] as unknown as { content: string };
  expect(sys0.content).toContain('Name: Test chore');
  expect(sys1.content).toContain('Name: Renamed by agent');
});

test('send on an unknown workflow rejects and clears the busy flag', async () => {
  const { agent } = setup();
  await expect(agent.send('nope', 'hi')).rejects.toThrow('Unknown workflow: nope');
  expect(agent.isBusy('nope')).toBe(false);
});

test('a direct second send while busy rejects with the busy error', async () => {
  const s = setup([]);
  const resolvers: ((v: ChatToolsResult) => void)[] = [];
  const gated: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: (o: ChatToolsOptions) => {
      s.calls.push(o);
      return new Promise<ChatToolsResult>((resolve) => resolvers.push(resolve));
    },
  };
  const agent = createBuilderAgent({
    gateway: gated,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  const textResult = (text: string): ChatToolsResult =>
    ({
      message: { role: 'assistant', content: text, refusal: null },
      toolCalls: [],
      model: 'test-model',
      tokens: { input: 0, output: 0 },
      costUsd: 0,
    }) as never;
  const first = agent.send(s.wf.id, 'one');
  expect(agent.isBusy(s.wf.id)).toBe(true);
  await expect(agent.send(s.wf.id, 'two')).rejects.toThrow(AgentBusyError);
  await expect(agent.send(s.wf.id, 'two')).rejects.toThrow('Still thinking about your last message.');
  resolvers.splice(0).forEach((r) => r(textResult('done one')));
  await first;
  expect(agent.isBusy(s.wf.id)).toBe(false);
});

test('busy is per workflow: two workflows can think at once', async () => {
  const s = setup([]);
  const resolvers: ((v: ChatToolsResult) => void)[] = [];
  const gated: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: (o: ChatToolsOptions) => {
      s.calls.push(o);
      return new Promise<ChatToolsResult>((resolve) => resolvers.push(resolve));
    },
  };
  const agent = createBuilderAgent({
    gateway: gated,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  const other = s.ops.create({ name: 'Other', description: 'Other.' });
  const p1 = agent.send(s.wf.id, 'one');
  const p2 = agent.send(other.id, 'two');
  expect(agent.isBusy(s.wf.id)).toBe(true);
  expect(agent.isBusy(other.id)).toBe(true);
  const textResult = {
    message: { role: 'assistant', content: 'ok', refusal: null },
    toolCalls: [],
    model: 'test-model',
    tokens: { input: 0, output: 0 },
    costUsd: 0,
  } as never;
  resolvers.splice(0).forEach((r) => r(textResult));
  await Promise.all([p1, p2]);
});

test('a second POST while busy returns 409', async () => {
  const s = setup([]);
  const resolvers: ((v: ChatToolsResult) => void)[] = [];
  const gated: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: (o: ChatToolsOptions) => {
      s.calls.push(o);
      return new Promise<ChatToolsResult>((resolve) => resolvers.push(resolve));
    },
  };
  const agent = createBuilderAgent({
    gateway: gated,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  const app = createApp({
    repo: s.repo,
    tables: s.tables,
    ops: s.ops,
    agent,
    agentEvents: s.agentEvents,
  });
  const first = postJson(app, `/api/workflows/${s.wf.id}/agent`, { text: 'one' });
  // The gated gateway holds the turn open, so waiting for busy is enough to
  // make the race deterministic.
  const deadline = Date.now() + 2000;
  while (!agent.isBusy(s.wf.id)) {
    if (Date.now() > deadline) throw new Error('first send never set busy');
    await new Promise((r) => setTimeout(r, 5));
  }
  const second = await postJson(app, `/api/workflows/${s.wf.id}/agent`, { text: 'two' });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: 'Still thinking about your last message.' });
  resolvers.splice(0).forEach((r) =>
    r({
      message: { role: 'assistant', content: 'done one', refusal: null },
      toolCalls: [],
      model: 'test-model',
      tokens: { input: 0, output: 0 },
      costUsd: 0,
    } as never),
  );
  const firstRes = await first;
  expect(firstRes.status).toBe(202);
});

test('agent routes 404 unknown workflows and 400 bad bodies', async () => {
  const { app, wf } = setupApp();
  const missingGet = await app.request('/api/workflows/nope/agent');
  expect(missingGet.status).toBe(404);
  const missingPost = await postJson(app, '/api/workflows/nope/agent', { text: 'hi' });
  expect(missingPost.status).toBe(404);
  for (const bad of [{}, { text: 42 }, { text: '' }, { text: 'hi', extra: 1 }]) {
    const res = await postJson(app, `/api/workflows/${wf.id}/agent`, bad);
    expect(res.status).toBe(400);
  }
  const empty = await app.request(`/api/workflows/${wf.id}/agent`);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual([]);
});

test('GET returns the visible transcript with ask options across turns', async () => {
  const t = setupApp([
    {
      calls: [
        {
          name: 'ask_user',
          args: { question: 'Which list?', options: ['Customers', 'Orders'] },
        },
      ],
    },
    { text: 'Saved!' },
  ]);
  await t.agent.send(t.wf.id, 'save them');
  await t.agent.send(t.wf.id, 'Customers');
  // ask_user ends its turn: one model call per turn.
  expect(t.calls).toHaveLength(2);
  const res = await t.app.request(`/api/workflows/${t.wf.id}/agent`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { role: 'dad', text: 'save them', at: expect.any(Number) },
    {
      role: 'agent',
      text: 'Which list?',
      ask: { question: 'Which list?', options: ['Customers', 'Orders'] },
      at: expect.any(Number),
    },
    { role: 'dad', text: 'Customers', at: expect.any(Number) },
    { role: 'agent', text: 'Saved!', at: expect.any(Number) },
  ]);
});

test('GET /api/events also carries agent events', async () => {
  const t = setupApp([{ text: 'hello dad' }]);
  const res = await t.app.request('/api/events');
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  try {
    const first = reader.read();
    await new Promise((r) => setTimeout(r, 50));
    await t.agent.send(t.wf.id, 'hi');
    const { value } = await first;
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"type":"agent"');
    expect(text).toContain(t.wf.id);
    expect(text).toContain('hello dad');
  } finally {
    await reader.cancel();
  }
}, 5000);

test("ops onChange reaches the conversation only for Dad's edits", async () => {
  const { ops, conversations } = createServer({ dbFile: ':memory:' });
  const wf = ops.create({ name: 'W', description: 'D' });
  expect(conversations.load(wf.id)).toBeUndefined();
  ops.move(wf.id, 'trigger', { x: 5, y: 5 }, { by: 'dad' });
  const afterDad = conversations.load(wf.id)!;
  expect(afterDad.messages).toHaveLength(1);
  expect(afterDad.messages[0]).toMatchObject({ role: 'system' });
  expect((afterDad.messages[0] as { content: string }).content.startsWith('Dad changed the canvas:')).toBe(
    true,
  );
  // The agent's own ops (explicit and default) must not self-notify.
  ops.move(wf.id, 'trigger', { x: 9, y: 9 }, { by: 'agent' });
  ops.move(wf.id, 'trigger', { x: 1, y: 1 });
  expect(conversations.load(wf.id)!.messages).toHaveLength(1);
});

test("a gateway failure on the first call still persists Dad's message and ends the turn", async () => {
  const s = setup([]);
  const boom: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: async (o: ChatToolsOptions) => {
      s.calls.push(o);
      throw new Error('model exploded');
    },
  };
  const agent = createBuilderAgent({
    gateway: boom,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  await expect(agent.send(s.wf.id, 'hello?')).rejects.toThrow('model exploded');
  expect(agent.isBusy(s.wf.id)).toBe(false);
  // A terminal event is still emitted: done closes the turn.
  expect(s.seen[s.seen.length - 1]!.event).toEqual({ type: 'done' });
  // Dad sees a failure line, not silence.
  const says = s.seen.filter((e) => e.event.type === 'say');
  expect(says).toHaveLength(1);
  expect((says[0]!.event as { text: string }).text).toContain('Something went wrong');
  // Dad's message survived: a reopened store sees it.
  const reopened = createConversationStore(s.db);
  const conv = reopened.load(s.wf.id)!;
  expect(conv.messages).toEqual([{ role: 'user', content: 'hello?' }]);
  expect(conv.transcript.map((t) => t.role)).toEqual(['dad', 'agent']);
});

test('a mid-turn gateway failure persists the partial turn and ends it', async () => {
  const s = setup([]);
  const { gateway: scripted } = scriptedGateway([
    { calls: [{ name: 'add_step', args: { ...WRITE_ARGS } }] },
  ]);
  let n = 0;
  const flaky: Gateway = {
    chatJson: s.gateway.chatJson,
    chatTools: async (o: ChatToolsOptions) => {
      n += 1;
      s.calls.push(o);
      if (n === 2) throw new Error('rate limited');
      return scripted.chatTools(o);
    },
  };
  const agent = createBuilderAgent({
    gateway: flaky,
    ops: s.ops,
    tables: s.tables,
    repo: s.repo,
    engine: {} as never,
    events: s.agentEvents,
    conversations: s.conversations,
    testRun: s.testRun,
  });
  await expect(agent.send(s.wf.id, 'build it')).rejects.toThrow('rate limited');
  expect(agent.isBusy(s.wf.id)).toBe(false);
  expect(s.calls).toHaveLength(2);
  // One tool already executed: its built event was observed.
  expect(s.seen.some((e) => e.event.type === 'built')).toBe(true);
  expect(s.seen[s.seen.length - 1]!.event).toEqual({ type: 'done' });
  // Partial state persisted: user + assistant + tool result.
  const reopened = createConversationStore(s.db);
  const conv = reopened.load(s.wf.id)!;
  expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(conv.transcript[0]).toMatchObject({ role: 'dad', text: 'build it' });
});

test('endTurn with sibling calls runs the whole response then stops', async () => {
  const { agent, seen, calls, conversations, wf } = setup([
    {
      calls: [
        { name: 'add_step', args: { ...WRITE_ARGS } },
        { name: 'ask_user', args: { question: 'Which list?', options: ['A', 'B'] } },
      ],
    },
  ]);
  await agent.send(wf.id, 'build and ask');
  // The model is not called again after the endTurn response.
  expect(calls).toHaveLength(1);
  const kinds = seen.map((s) => s.event.type);
  expect(kinds).toContain('built');
  expect(kinds).toContain('ask');
  expect(kinds[kinds.length - 1]).toBe('done');
  const conv = conversations.load(wf.id)!;
  expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
});
