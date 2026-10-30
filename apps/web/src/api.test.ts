import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, approveStep, getRun, getSettings, putSettings, useTimezoneSync } from './api.ts';

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

describe('settings', () => {
  test('getSettings returns the stored timezone', async () => {
    stubFetch({ ok: true, status: 200, text: JSON.stringify({ timezone: 'America/New_York' }) });
    await expect(getSettings()).resolves.toEqual({ timezone: 'America/New_York' });
  });

  test('putSettings PUTs the timezone as JSON', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ timezone: 'America/New_York' }),
      json: async () => ({ timezone: 'America/New_York' }),
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(putSettings('America/New_York')).resolves.toEqual({
      timezone: 'America/New_York',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ timezone: 'America/New_York' });
  });

  function probe() {
    return createElement(function Probe() {
      useTimezoneSync();
      return null;
    });
  }

  function stubSettingsApi(stored: string | null) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const body = init?.method === 'PUT' ? {} : { timezone: stored };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
          json: async () => body,
        };
      }),
    );
    return calls;
  }

  test('useTimezoneSync posts the browser zone when none is stored', async () => {
    const calls = stubSettingsApi(null);
    render(probe());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ url: '/api/settings' });
    expect(calls[0]!.init).toBeUndefined();
    expect(calls[1]!.url).toBe('/api/settings');
    expect(calls[1]!.init?.method).toBe('PUT');
    expect(JSON.parse(calls[1]!.init?.body as string)).toEqual({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  test('useTimezoneSync never overwrites a stored zone', async () => {
    const calls = stubSettingsApi('America/New_York');
    render(probe());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/settings' });
  });
});
