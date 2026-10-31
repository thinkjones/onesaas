import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { createGateway, checkGlimmer } from '../src/models/gateway.js';
import { createServer } from '../src/main.js';

const GLIMMER_MODEL = 'muse-glimmer-test';
const GLIMMER_BASE = 'http://127.0.0.1:1234/v1';
const DOWN_NOTE = "Glimmer isn't running on this computer";

const triageSchema = z.object({ isCustomer: z.boolean(), why: z.string() });

function chatResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

const TRIAGE_OK = chatResponse('{"isCustomer":true,"why":"A customer asks about an order."}');

function fakeChatClient(impl: (params: unknown) => Promise<unknown>) {
  const calls: unknown[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls.push(params);
          return impl(params);
        },
      },
    },
  };
  return { client: client as never, calls };
}

/** A fetch stub serving a fixed /models list; records every URL it sees. */
function modelsFetch(models: string[] | 'down') {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (models === 'down') return { ok: false, status: 500, json: async () => ({}) } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: models.map((id) => ({ id })) }),
    } as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

function healthyGateway(opts?: { glimmerImpl?: (params: unknown) => Promise<unknown> }) {
  const meta = fakeChatClient(async () => TRIAGE_OK);
  const glimmer = fakeChatClient(opts?.glimmerImpl ?? (async () => TRIAGE_OK));
  const { fetchFn, calls: fetchCalls } = modelsFetch([GLIMMER_MODEL]);
  const gateway = createGateway({
    providers: { meta: meta.client, glimmer: glimmer.client },
    roles: { triage: { provider: 'glimmer', model: GLIMMER_MODEL } },
    glimmerHealth: { baseUrl: GLIMMER_BASE, model: GLIMMER_MODEL, fetchFn },
  });
  return { gateway, meta, glimmer, fetchCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env['GLIMMER_BASE_URL'];
  delete process.env['GLIMMER_MODEL'];
});

function triageCall() {
  return {
    role: 'triage' as const,
    system: 'You triage incoming email.',
    user: 'Subject: help\nSnippet: please',
    schema: triageSchema,
    schemaName: 'email_triage',
  };
}

test('healthy glimmer serves triage with json_object and free cost', async () => {
  const { gateway, meta, glimmer } = healthyGateway();
  try {
    expect(await gateway.ready()).toBe(true);
    const result = await gateway.chatJson(triageCall());
    expect(result.data).toEqual({ isCustomer: true, why: 'A customer asks about an order.' });
    expect(result.model).toBe(GLIMMER_MODEL);
    expect(result.costUsd).toBe(0);
    expect(glimmer.calls).toHaveLength(1);
    expect(meta.calls).toHaveLength(0);
    const sent = glimmer.calls[0] as Record<string, unknown>;
    expect(sent['model']).toBe(GLIMMER_MODEL);
    expect(sent['response_format']).toEqual({ type: 'json_object' });
    // The schema rides in the system prompt since json_object carries none.
    const messages = sent['messages'] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('You triage incoming email.');
    expect(system).toContain('isCustomer');
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'glimmer',
      model: GLIMMER_MODEL,
      healthy: true,
    });
  } finally {
    gateway.stop();
  }
});

test('non-triage roles stay on meta with json_schema when glimmer is healthy', async () => {
  const meta = fakeChatClient(async () => chatResponse('{"name":"hammer"}'));
  const glimmer = fakeChatClient(async () => TRIAGE_OK);
  const { fetchFn } = modelsFetch([GLIMMER_MODEL]);
  const gateway = createGateway({
    providers: { meta: meta.client, glimmer: glimmer.client },
    roles: { triage: { provider: 'glimmer', model: GLIMMER_MODEL } },
    glimmerHealth: { baseUrl: GLIMMER_BASE, model: GLIMMER_MODEL, fetchFn },
  });
  try {
    await gateway.ready();
    const item = z.object({ name: z.string() });
    const built = await gateway.chatJson({
      role: 'builder',
      system: 'sys',
      user: 'usr',
      schema: item,
      schemaName: 'item',
    });
    expect(built.model).toBe('muse-spark-1.3');
    const planned = await gateway.chatJson({
      role: 'planner',
      system: 'sys',
      user: 'usr',
      schema: item,
      schemaName: 'item',
    });
    expect(planned.model).toBe('muse-wonder-1.0');
    expect(glimmer.calls).toHaveLength(0);
    expect(meta.calls).toHaveLength(2);
    for (const call of meta.calls) {
      expect((call as Record<string, unknown>)['response_format']).toMatchObject({
        type: 'json_schema',
      });
    }
    for (const role of ['builder', 'planner', 'vision'] as const) {
      const row = gateway.status().find((s) => s.role === role);
      expect(row?.provider).toBe('meta');
      expect(row?.healthy).toBe(true);
      expect(row?.note).toBeUndefined();
    }
  } finally {
    gateway.stop();
  }
});

test('a throwing glimmer client falls back to spark and marks triage unhealthy', async () => {
  const { gateway, meta, glimmer } = healthyGateway({
    glimmerImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  try {
    expect(await gateway.ready()).toBe(true);
    const result = await gateway.chatJson(triageCall());
    expect(result.data).toEqual({ isCustomer: true, why: 'A customer asks about an order.' });
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(meta.calls).toHaveLength(1);
    expect((meta.calls[0] as Record<string, unknown>)['response_format']).toMatchObject({
      type: 'json_schema',
    });
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'glimmer',
      model: GLIMMER_MODEL,
      healthy: false,
      note: DOWN_NOTE,
    });
    // Marked unhealthy: the next call skips glimmer and goes straight to spark.
    await gateway.chatJson(triageCall());
    expect(glimmer.calls).toHaveLength(1);
    expect(meta.calls).toHaveLength(2);
  } finally {
    gateway.stop();
  }
});

test('glimmer returning invalid JSON falls back to spark and marks triage unhealthy', async () => {
  const { gateway, meta } = healthyGateway({
    glimmerImpl: async () => chatResponse('not json{'),
  });
  try {
    await gateway.ready();
    const result = await gateway.chatJson(triageCall());
    expect(result.data.isCustomer).toBe(true);
    expect(result.model).toBe('muse-spark-1.3');
    expect(meta.calls).toHaveLength(1);
    expect(gateway.status().find((s) => s.role === 'triage')?.healthy).toBe(false);
  } finally {
    gateway.stop();
  }
});

test('a re-check revives glimmer after the failure clears', async () => {
  const { gateway, meta, glimmer } = healthyGateway({
    glimmerImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  try {
    await gateway.ready();
    await gateway.chatJson(triageCall());
    expect(gateway.status().find((s) => s.role === 'triage')?.healthy).toBe(false);
    // LM Studio is back: the /models list still names the model.
    expect(await gateway.recheck()).toBe(true);
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'glimmer',
      model: GLIMMER_MODEL,
      healthy: true,
    });
    // Revived: triage goes back to glimmer (and fails over again on error).
    await expect(gateway.chatJson(triageCall())).resolves.toBeDefined();
    expect(glimmer.calls).toHaveLength(2);
    expect(meta.calls).toHaveLength(2);
  } finally {
    gateway.stop();
  }
});

test('glimmer configured but down serves triage from spark with the note', async () => {
  const meta = fakeChatClient(async () => TRIAGE_OK);
  const glimmer = fakeChatClient(async () => TRIAGE_OK);
  const { fetchFn } = modelsFetch('down');
  const gateway = createGateway({
    providers: { meta: meta.client, glimmer: glimmer.client },
    roles: { triage: { provider: 'glimmer', model: GLIMMER_MODEL } },
    glimmerHealth: { baseUrl: GLIMMER_BASE, model: GLIMMER_MODEL, fetchFn },
  });
  try {
    expect(await gateway.ready()).toBe(false);
    const result = await gateway.chatJson(triageCall());
    expect(result.data.isCustomer).toBe(true);
    expect(result.model).toBe('muse-spark-1.3');
    expect(glimmer.calls).toHaveLength(0);
    expect(meta.calls).toHaveLength(1);
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'glimmer',
      model: GLIMMER_MODEL,
      healthy: false,
      note: DOWN_NOTE,
    });
  } finally {
    gateway.stop();
  }
});

test('legacy single-client gateway shows triage on spark with the note', async () => {
  const meta = fakeChatClient(async () => TRIAGE_OK);
  const gateway = createGateway({ client: meta.client });
  try {
    await gateway.ready();
    const result = await gateway.chatJson(triageCall());
    expect(result.model).toBe('muse-spark-1.3');
    expect(meta.calls).toHaveLength(1);
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'meta',
      model: 'muse-spark-1.3',
      healthy: true,
      note: DOWN_NOTE,
    });
  } finally {
    gateway.stop();
  }
});

test('health re-checks every 60s until stop()', async () => {
  vi.useFakeTimers();
  const { gateway, fetchCalls } = healthyGateway();
  try {
    await gateway.ready();
    expect(fetchCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1]).toBe(`${GLIMMER_BASE}/models`);
    gateway.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchCalls).toHaveLength(2);
  } finally {
    gateway.stop();
  }
});

test('checkGlimmer is true only when /models lists the model', async () => {
  const { fetchFn, calls } = modelsFetch(['other-model', GLIMMER_MODEL]);
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, fetchFn)).resolves.toBe(true);
  expect(calls).toEqual([`${GLIMMER_BASE}/models`]);
  // A trailing slash on the base never doubles the slash.
  await expect(checkGlimmer(`${GLIMMER_BASE}/`, GLIMMER_MODEL, fetchFn)).resolves.toBe(true);
  expect(calls[1]).toBe(`${GLIMMER_BASE}/models`);
  const missing = modelsFetch(['other-model']);
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, missing.fetchFn)).resolves.toBe(false);
  const down = modelsFetch('down');
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, down.fetchFn)).resolves.toBe(false);
  const throwing = (async () => {
    throw new Error('socket hang up');
  }) as typeof fetch;
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, throwing)).resolves.toBe(false);
  const malformed = (async () =>
    ({ ok: true, json: async () => ({ data: 'nope' }) }) as Response) as typeof fetch;
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, malformed)).resolves.toBe(false);
});

test('checkGlimmer gives up after 3s', async () => {
  // Real timers: AbortSignal.timeout is native, so this proves the actual
  // 3 s path end to end (~3 s of suite time).
  const hanging = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  await expect(checkGlimmer(GLIMMER_BASE, GLIMMER_MODEL, hanging)).resolves.toBe(false);
}, 10000);

test('server boots with no glimmer env; triage on spark with the note', async () => {
  const { app, gateway } = createServer({ dbFile: ':memory:' });
  try {
    await gateway.ready();
    const res = await app.request('/api/models/status');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { role: string; provider: string; model: string; healthy: boolean; note?: string }[];
    expect(rows.map((r) => r.role).sort()).toEqual(['builder', 'planner', 'triage', 'vision']);
    expect(rows.find((r) => r.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'meta',
      model: 'muse-spark-1.3',
      healthy: true,
      note: DOWN_NOTE,
    });
  } finally {
    gateway.stop();
  }
});

test('server still boots with glimmer configured but down; triage falls back', async () => {
  process.env['GLIMMER_BASE_URL'] = 'http://127.0.0.1:9/v1';
  process.env['GLIMMER_MODEL'] = GLIMMER_MODEL;
  const { gateway } = createServer({ dbFile: ':memory:' });
  try {
    expect(await gateway.ready()).toBe(false);
    expect(gateway.status().find((s) => s.role === 'triage')).toMatchObject({
      healthy: false,
      note: DOWN_NOTE,
    });
  } finally {
    gateway.stop();
  }
});

test('server boots against a healthy glimmer stub and triages on it', async () => {
  // The real OpenAI SDK client uses global fetch, so stubbing fetch answers
  // both the /models health check and the /chat/completions call with no
  // sockets (sandboxes forbid listening).
  const completions: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [{ id: GLIMMER_MODEL }] }),
        } as Response;
      }
      if (href.endsWith('/chat/completions') && init?.method === 'POST') {
        completions.push(JSON.parse(String(init.body)) as unknown);
        const payload = {
          ...TRIAGE_OK,
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: GLIMMER_MODEL,
        };
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${init?.method} ${href}`);
    }) as typeof fetch,
  );
  process.env['GLIMMER_BASE_URL'] = 'http://127.0.0.1:1234/v1';
  process.env['GLIMMER_MODEL'] = GLIMMER_MODEL;
  const { gateway } = createServer({ dbFile: ':memory:' });
  try {
    expect(await gateway.ready()).toBe(true);
    expect(gateway.status().find((s) => s.role === 'triage')).toEqual({
      role: 'triage',
      provider: 'glimmer',
      model: GLIMMER_MODEL,
      healthy: true,
    });
    const result = await gateway.chatJson(triageCall());
    expect(result.data.isCustomer).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(completions).toHaveLength(1);
    expect((completions[0] as Record<string, unknown>)['response_format']).toEqual({
      type: 'json_object',
    });
  } finally {
    gateway.stop();
  }
});

test('GET /api/models/status is 500 without a gateway', async () => {
  const app = createApp({});
  const res = await app.request('/api/models/status');
  expect(res.status).toBe(500);
});
