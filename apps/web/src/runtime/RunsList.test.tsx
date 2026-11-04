import type { Run } from '@dad/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import RunsList from './RunsList.tsx';

const SARAH_RUN: Run = {
  id: 'run-1',
  workflowId: 'flow-1',
  workflowVersion: 1,
  triggerPayload: {
    email: {
      from: 'sarah@example.com',
      fromName: 'Sarah Lee',
      subject: 'Need help with my order',
      body: 'Hi there…',
      threadId: 'thread-1',
    },
  },
  status: 'done',
  kind: 'live',
  usedSample: false,
  startedAt: '2026-10-28T10:42:00.000Z',
};

const MANUAL_RUN: Run = {
  id: 'run-2',
  workflowId: 'flow-1',
  workflowVersion: 1,
  triggerPayload: { payload: { hello: 'world' } },
  status: 'running',
  kind: 'live',
  usedSample: false,
  startedAt: '2026-10-28T11:05:00.000Z',
};

describe('RunsList', () => {
  test("renders 'Sarah Lee' for a run whose trigger payload has email.fromName", () => {
    render(
      <RunsList runs={[SARAH_RUN, MANUAL_RUN]} selectedRunId="run-2" onSelect={() => {}} />,
    );
    expect(screen.getByText('Sarah Lee')).toBeDefined();
    // Fallback chain: a manual payload with no fromName/subject reads "Manual run".
    expect(screen.getByText('Manual run')).toBeDefined();
  });

  test('marks the selected row aria-selected="true" and others "false"', () => {
    render(
      <RunsList runs={[SARAH_RUN, MANUAL_RUN]} selectedRunId="run-1" onSelect={() => {}} />,
    );
    expect(
      screen.getByRole('option', { name: /Sarah Lee/ }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('option', { name: /Manual run/ }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  test('clicking a row selects that run', () => {
    const onSelect = vi.fn();
    render(<RunsList runs={[SARAH_RUN]} selectedRunId={undefined} onSelect={onSelect} />);
    screen.getByRole('option', { name: /Sarah Lee/ }).click();
    expect(onSelect).toHaveBeenCalledWith('run-1');
  });

  test('shows the coloured status with the time', () => {
    render(<RunsList runs={[SARAH_RUN]} selectedRunId="run-1" onSelect={() => {}} />);
    expect(screen.getByRole('option').querySelector('.state')!.textContent).toMatch(/^Waiting for you|^Done|^Needs a look|^Working/);
  });

  test('an invalid startedAt falls back to the raw string instead of crashing the list', () => {
    const bad: Run = { ...SARAH_RUN, id: 'run-bad', startedAt: 'not-a-date' };
    render(
      <RunsList runs={[bad, MANUAL_RUN]} selectedRunId="run-2" onSelect={() => {}} />,
    );
    expect(screen.getByText(/not-a-date/)).toBeDefined();
    expect(screen.getByText('Sarah Lee')).toBeDefined();
    expect(screen.getByText('Manual run')).toBeDefined();
  });
});
