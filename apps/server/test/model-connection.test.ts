import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createServer } from '../src/main.js';
import { createModelClients } from '../src/models/connection.js';

const put = (server: ReturnType<typeof createServer>, body: unknown) =>
  server.app.request('/api/models/connection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const CUSTOM = { baseUrl: 'https://llm.example/v1/', apiKey: 'sk-secret', model: 'gpt-x' };

describe('/api/models/connection', () => {
  test('saves the endpoint and never returns the key', async () => {
    const server = createServer({ dbFile: ':memory:' });
    const res = await put(server, CUSTOM);
    expect(res.status).toBe(200);
    const expected = { baseUrl: 'https://llm.example/v1', model: 'gpt-x', hasApiKey: true };
    expect(await res.json()).toEqual(expected);
    const got = await server.app.request('/api/models/connection');
    expect(await got.json()).toEqual(expected);
    const settings = await (await server.app.request('/api/settings')).text();
    expect(settings).not.toContain('sk-secret');
  });

  test('rejects a bad URL and an endpoint with no model', async () => {
    const server = createServer({ dbFile: ':memory:' });
    expect((await put(server, { ...CUSTOM, baseUrl: 'file:///etc/passwd' })).status).toBe(400);
    expect((await put(server, { ...CUSTOM, baseUrl: 'nope' })).status).toBe(400);
    expect((await put(server, { baseUrl: 'https://llm.example/v1' })).status).toBe(400);
    const got = await server.app.request('/api/models/connection');
    expect(await got.json()).toEqual({ baseUrl: '', model: '', hasApiKey: false });
  });

  test('moving endpoint forgets the old key, and editing the model keeps it', async () => {
    const server = createServer({ dbFile: ':memory:' });
    await put(server, CUSTOM);
    const kept = await put(server, { model: 'gpt-y' });
    expect(((await kept.json()) as { hasApiKey: boolean }).hasApiKey).toBe(true);
    const moved = await put(server, { baseUrl: 'https://other.example/v1' });
    expect(((await moved.json()) as { hasApiKey: boolean }).hasApiKey).toBe(false);
  });

  test('clearing the endpoint returns to Meta', async () => {
    const server = createServer({ dbFile: ':memory:' });
    await put(server, CUSTOM);
    const res = await put(server, { baseUrl: '', apiKey: '', model: '' });
    expect(await res.json()).toEqual({ baseUrl: '', model: '', hasApiKey: false });
    expect(server.gateway.status()[0]?.provider).toBe('meta');
  });

  test('model status names the custom model for every role, live', async () => {
    const server = createServer({ dbFile: ':memory:' });
    await put(server, CUSTOM);
    for (const row of server.gateway.status()) {
      expect(row).toMatchObject({ provider: 'custom', model: 'gpt-x' });
    }
  });
});

describe('keys stay with their own endpoint', () => {
  const store = (c: { baseUrl?: string; apiKey?: string; model?: string }) =>
    ({ get: () => c }) as Parameters<typeof createModelClients>[0]['store'];

  const authOf = (chat: unknown) =>
    (chat as { _client: { apiKey: string; baseURL: string } })._client;

  test('a custom endpoint never receives the Meta env key', () => {
    const clients = createModelClients({
      store: store({ baseUrl: 'https://llm.example/v1', model: 'm' }),
      envApiKey: 'meta-key',
    });
    const client = authOf(clients.chat.chat);
    expect(client.baseURL).toBe('https://llm.example/v1');
    expect(client.apiKey).not.toBe('meta-key');
  });

  test('Meta-only APIs never receive the custom endpoint key', () => {
    const clients = createModelClients({
      store: store({ baseUrl: 'https://llm.example/v1', apiKey: 'custom-key', model: 'm' }),
      envApiKey: 'meta-key',
    });
    expect(clients.metaApiKey()).toBe('meta-key');
    const images = authOf(clients.meta.images);
    expect(images.baseURL).toBe('https://api.meta.ai/v1');
    expect(images.apiKey).toBe('meta-key');
  });

  test('a key saved with no endpoint is used for Meta', () => {
    const clients = createModelClients({ store: store({ apiKey: 'saved' }), envApiKey: 'env' });
    expect(clients.metaApiKey()).toBe('saved');
    expect(authOf(clients.chat.chat).apiKey).toBe('saved');
  });
});

describe('a saved endpoint in use', () => {
  test('chat calls reach it with its key and model, and take effect without a restart', async () => {
    const seen: { auth?: string; path?: string; body: Record<string, unknown> }[] = [];
    const fake = createHttpServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, path: req.url, body: JSON.parse(raw) });
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-x',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } },
            ],
          }),
        );
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    try {
      const { port } = fake.address() as AddressInfo;
      const server = createServer({ dbFile: ':memory:' });
      await put(server, { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-secret', model: 'gpt-x' });
      const result = await server.gateway.chatJson({
        role: 'builder',
        system: 'Answer in JSON.',
        user: 'ok?',
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'Ok',
      });
      expect(result.data).toEqual({ ok: true });
      expect(seen[0]).toMatchObject({
        auth: 'Bearer sk-secret',
        path: '/v1/chat/completions',
        body: { model: 'gpt-x', response_format: { type: 'json_object' } },
      });
    } finally {
      fake.close();
    }
  });
});
