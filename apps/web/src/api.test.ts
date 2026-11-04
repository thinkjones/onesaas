import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, apiUrl, approveStep, getRun, getSettings, isTauri, putSettings, useTimezoneSync } from './api.ts';

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
  const doc = {
    timezone: 'America/New_York',
    textSize: 'normal',
    onboarded: false,
    moodFileIds: [],
  };

  test('getSettings returns the settings document', async () => {
    stubFetch({ ok: true, status: 200, text: JSON.stringify(doc) });
    await expect(getSettings()).resolves.toEqual(doc);
  });

  test('putSettings PUTs the patch as JSON', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(doc),
      json: async () => doc,
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(putSettings({ timezone: 'America/New_York' })).resolves.toEqual(doc);
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

  function stubSettingsApi(stored: string) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const body = init?.method === 'PUT' ? doc : { ...doc, timezone: stored };
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
    const calls = stubSettingsApi('');
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

describe('desktop shell URLs', () => {
  test('apiUrl prefixes loopback under Tauri, passthrough otherwise', () => {
    expect(isTauri()).toBe(false);
    expect(apiUrl('/api/settings')).toBe('/api/settings');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
    expect(apiUrl('/api/settings')).toBe('http://127.0.0.1:8787/api/settings');
  });

  test('fetches go absolute under Tauri', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await getSettings();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/api/settings');
  });
});
