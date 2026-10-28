import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunUpdate } from '../api.ts';
import ApprovalCard from './ApprovalCard.tsx';

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

function stubFetchOk() {
  // Params mirror fetch's (url, init) so mock.calls keeps both.
  return vi.fn(async (_url: string, _init?: { body?: unknown }) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(UPDATE),
    json: async () => UPDATE,
  }));
}

function renderCard(proposedText = 'Hi Sarah, thanks for writing!') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApprovalCard
        runId="run-1"
        stepId="approve"
        question="Is this reply OK to put in Gmail?"
        proposedText={proposedText}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApprovalCard', () => {
  test('shows the question with the proposal pre-filled', () => {
    vi.stubGlobal('fetch', stubFetchOk());
    renderCard();
    expect(screen.getByText('Is this reply OK to put in Gmail?')).toBeDefined();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Hi Sarah, thanks for writing!',
    );
  });

  test('clearing the textarea disables every approve button and shows "The reply is empty"', () => {
    vi.stubGlobal('fetch', stubFetchOk());
    renderCard();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Looks good' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Use my changes' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('The reply is empty')).toBeDefined();
    // Skip is the escape hatch for an empty proposal, so it stays enabled.
    expect(screen.getByRole('button', { name: 'Skip' }).hasAttribute('disabled')).toBe(false);
  });

  test('"Use my changes" is disabled until the text is edited, then sends {action:edit,text}', async () => {
    const fetch = stubFetchOk();
    vi.stubGlobal('fetch', fetch);
    renderCard();
    const editButton = screen.getByRole('button', { name: 'Use my changes' });
    expect(editButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hi Sarah, thanks a lot!' } });
    expect(editButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(editButton);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(fetch.mock.calls[0]![0]).toBe('/api/runs/run-1/steps/approve/approval');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      action: 'edit',
      text: 'Hi Sarah, thanks a lot!',
    });
  });

  test('"Looks good" sends exactly {action:approve} (surplus keys 400)', async () => {
    const fetch = stubFetchOk();
    vi.stubGlobal('fetch', fetch);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ action: 'approve' });
  });

  test('"Skip" sends exactly {action:skip}', async () => {
    const fetch = stubFetchOk();
    vi.stubGlobal('fetch', fetch);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ action: 'skip' });
  });

  test('all buttons disable while the mutation is in flight (no double-submit)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Promise(() => {})),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Looks good' }).hasAttribute('disabled')).toBe(
        true,
      );
    });
    expect(screen.getByRole('button', { name: 'Use my changes' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Skip' }).hasAttribute('disabled')).toBe(true);
  });
});
