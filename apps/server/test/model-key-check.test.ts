import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createModelClients, createModelConnectionStore } from '../src/models/connection.js';

function memoryKv() {
  const rows = new Map<string, string>();
  return {
    get: (k: string) => rows.get(k),
    set: (k: string, v: string) => void rows.set(k, v),
    del: (k: string) => void rows.delete(k),
  };
}

let server: Server | undefined;
afterEach(() => server?.close());

async function endpointAnswering(status: number): Promise<string> {
  server = createHttpServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? '{"object":"list","data":[]}' : '{"error":{"message":"no"}}');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function check(status: number) {
  const store = createModelConnectionStore(memoryKv());
  store.update({ baseUrl: await endpointAnswering(status), apiKey: 'k', model: 'm' });
  return createModelClients({ store }).checkKey();
}

describe('checking the model key', () => {
  test('no key at all is missing, without calling anyone', async () => {
    const store = createModelConnectionStore(memoryKv());
    expect(await createModelClients({ store }).checkKey()).toBe('missing');
  });

  test('a clear no is rejected', async () => {
    expect(await check(401)).toBe('rejected');
    server?.close();
    expect(await check(403)).toBe('rejected');
  });

  test('a working key is ok', async () => {
    expect(await check(200)).toBe('ok');
  });

  test('a server without that route says nothing about the key', async () => {
    expect(await check(404)).toBe('unknown');
    server?.close();
    expect(await check(500)).toBe('unknown');
  });
});
