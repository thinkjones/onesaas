import type { StepRun } from '@onesaas/shared';
import { describe, expect, test } from 'vitest';
import { outcomeOf } from './outcome.ts';

function stepRun(partial: Partial<StepRun> & { status: StepRun['status'] }): StepRun {
  return {
    id: 'sr-1',
    runId: 'run-1',
    stepId: 's1',
    startedAt: '2026-10-28T10:42:00.000Z',
    ...partial,
  };
}

describe('outcomeOf', () => {
  test('a missing record has no outcome', () => {
    expect(outcomeOf(undefined)).toBeUndefined();
  });

  test('a pending step has no outcome', () => {
    expect(outcomeOf(stepRun({ status: 'pending' }))).toBeUndefined();
  });

  test('a done step shows its why', () => {
    expect(outcomeOf(stepRun({ status: 'done', why: 'Saved the lead.' }))).toBe('Saved the lead.');
  });

  test('a done step without a why has no outcome', () => {
    expect(outcomeOf(stepRun({ status: 'done' }))).toBeUndefined();
  });

  test('a failed step shows its error', () => {
    expect(outcomeOf(stepRun({ status: 'failed', error: 'Row is empty.' }))).toBe('Row is empty.');
  });

  test('a failed step without an error shows the fallback', () => {
    expect(outcomeOf(stepRun({ status: 'failed' }))).toBe('Something went wrong.');
  });

  test('a waiting step asks for a check', () => {
    expect(outcomeOf(stepRun({ status: 'waiting' }))).toBe('Waiting for you to check.');
  });

  test('a running step says so', () => {
    expect(outcomeOf(stepRun({ status: 'running' }))).toBe('Running…');
  });

  test('a skipped step says so', () => {
    expect(outcomeOf(stepRun({ status: 'skipped' }))).toBe('Skipped.');
  });
});
