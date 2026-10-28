import type { StepRun } from '@dad/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import Inspector from './Inspector.tsx';

const EXTRACT_DONE: StepRun = {
  id: 'sr-1',
  runId: 'run-1',
  stepId: 'extract',
  status: 'done',
  input: { text: 'From Sarah Lee <sarah@example.com>' },
  output: { name: 'Sarah Lee', email: 'sarah@example.com' },
  model: 'meta-llama/test',
  costUsd: 0.0012,
  durationMs: 1200,
  why: "Found Sarah's name and email.",
  startedAt: '2026-10-28T10:42:00.000Z',
};

function renderInspector(stepRun: StepRun | undefined = EXTRACT_DONE) {
  return render(
    <Inspector stepRun={stepRun} title="Extract details" open={true} onClose={() => {}} />,
  );
}

describe('Inspector', () => {
  test('done extract shows the why text, a "name: Sarah Lee" output row, and "$0.0012"', () => {
    renderInspector();
    expect(screen.getByText("Found Sarah's name and email.")).toBeDefined();
    expect(screen.getByText('What came out')).toBeDefined();
    expect(screen.getByText('name: Sarah Lee')).toBeDefined();
    expect(screen.getByText('$0.0012')).toBeDefined();
    expect(screen.getByText('1.2 s')).toBeDefined();
  });

  test('raw JSON is hidden until "Show details" is clicked', () => {
    renderInspector();
    // document, not container: the sheet renders in a portal on body.
    expect(document.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('"name": "Sarah Lee"');
  });

  test('skipped approval output renders as "Proposed (skipped)" instead of a raw proposed key', () => {
    const skipped: StepRun = {
      ...EXTRACT_DONE,
      stepId: 'approve',
      status: 'skipped',
      output: { proposed: { text: 'Hi Sarah!' } },
      why: 'You chose to skip this.',
      costUsd: undefined,
      durationMs: undefined,
    };
    render(
      <Inspector stepRun={skipped} title="Check the reply" open={true} onClose={() => {}} />,
    );
    expect(screen.getByText('Proposed (skipped)')).toBeDefined();
    expect(screen.queryByText('proposed: [object Object]')).toBeNull();
  });

  test('closing the sheet calls onClose', () => {
    const onClose = vi.fn();
    render(<Inspector stepRun={EXTRACT_DONE} title="Extract details" open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
