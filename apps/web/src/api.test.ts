import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, approveStep, getRun } from './api.ts';

function stubFetch(res: { ok: boolean; status: number; text?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: res.ok,
      status: res.status,
      text: async () => res.text ?? '',
      json: async () => JSON.parse(res.text ?? ''),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API error surface', () => {
  test('POST extracts server {error} message and carries status', async () => {
    stubFetch({ ok: false, status: 422, text: JSON.stringify({ error: 'The reply is empty' }) });
    const err = await approveStep('r1', 's1', { action: 'edit', text: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('The reply is empty');
    expect((err as ApiError).status).toBe(422);
  });

  test('GET extracts server {error} message and carries status', async () => {
    stubFetch({ ok: false, status: 404, text: JSON.stringify({ error: 'Unknown run: nope' }) });
    const err = await getRun('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Unknown run: nope');
    expect((err as ApiError).status).toBe(404);
  });

  test('non-JSON bodies fall back to raw text with status', async () => {
    stubFetch({ ok: false, status: 500, text: 'Internal Server Error' });
    const err = await getRun('r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Internal Server Error');
    expect((err as ApiError).status).toBe(500);
  });
});
