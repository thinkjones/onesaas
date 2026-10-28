import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunUpdate } from '../api.ts';
import FailureCard from './FailureCard.tsx';

const UPDATE: RunUpdate = {
  run: {
    id: 'run-1',
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'running',
    startedAt: '2026-10-28T10:42:00.000Z',
  },
  steps: [],
  story: [],
};

function renderCard(error = 'I need Gmail open in Chrome to do this.') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FailureCard runId="run-1" stepId="draft" error={error} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FailureCard', () => {
  test('shows the error and retries on "Try again"', async () => {
    // Params mirror fetch's (url, init) so mock.calls keeps both.
    const fetch = vi.fn(async (_url: string, _init?: { body?: unknown }) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(UPDATE),
      json: async () => UPDATE,
    }));
    vi.stubGlobal('fetch', fetch);
    renderCard();
    expect(screen.getByText('I need Gmail open in Chrome to do this.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(fetch.mock.calls[0]![0]).toBe('/api/runs/run-1/steps/draft/retry');
  });

  test('"Try again" disables while the retry is in flight (no double-submit)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Promise(() => {})),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try again' }).hasAttribute('disabled')).toBe(
        true,
      );
    });
  });

  test('"Fix this step" is disabled with a "Coming soon" tooltip until M3', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unexpected fetch');
      }),
    );
    renderCard();
    const fix = screen.getByRole('button', { name: 'Fix this step' });
    expect(fix.hasAttribute('disabled')).toBe(true);
    expect(fix.getAttribute('title')).toBe('Coming soon');
  });
});
