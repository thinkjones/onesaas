import type { Run, StepInstance, Workflow } from '@dad/shared';
import { describe, expect, test } from 'vitest';
import { parseModeParam, resolveRunId, resolveStepId } from './params.ts';

function run(id: string): Run {
  return {
    id,
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt: '2026-10-28T10:42:00.000Z',
  };
}

function step(id: string): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title: id,
    summary: `${id} summary.`,
    config: {},
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

const WF: Workflow = {
  id: 'flow-1',
  name: 'Test flow',
  description: 'Test flow.',
  version: 1,
  status: 'on',
  trigger: step('trigger'),
  steps: [step('extract')],
  edges: [{ from: 'trigger', to: 'extract' }],
};

describe('resolveRunId', () => {
  const runs = [run('run-new'), run('run-old')]; // server lists newest-first

  test('absent ?run= selects the newest run', () => {
    expect(resolveRunId(null, runs)).toBe('run-new');
  });

  test('a valid id wins over newest', () => {
    expect(resolveRunId('run-old', runs)).toBe('run-old');
  });

  test('a stale id (not in the list) falls back to newest', () => {
    expect(resolveRunId('run-gone', runs)).toBe('run-new');
  });

  test('undefined while runs load, or when the workflow has no runs', () => {
    expect(resolveRunId(null, undefined)).toBeUndefined();
    expect(resolveRunId('run-new', undefined)).toBeUndefined();
    expect(resolveRunId(null, [])).toBeUndefined();
  });
});

describe('resolveStepId', () => {
  test('a valid step id selects that step', () => {
    expect(resolveStepId('extract', WF)).toBe('extract');
  });

  test('the trigger id is selectable too', () => {
    expect(resolveStepId('trigger', WF)).toBe('trigger');
  });

  test('a stale id (e.g. cross-version link) closes the inspector', () => {
    expect(resolveStepId('renamed-step', WF)).toBeUndefined();
  });

  test('absent ?step=, or a workflow that failed to load, closes the inspector', () => {
    expect(resolveStepId(null, WF)).toBeUndefined();
    expect(resolveStepId('extract', undefined)).toBeUndefined();
  });
});

describe('parseModeParam', () => {
  test('absent or runtime stays on runtime', () => {
    expect(parseModeParam(null)).toBe('runtime');
    expect(parseModeParam('runtime')).toBe('runtime');
  });

  test('design selects the design branch', () => {
    expect(parseModeParam('design')).toBe('design');
  });

  test('garbage falls back to runtime', () => {
    expect(parseModeParam('garbage')).toBe('runtime');
    expect(parseModeParam('')).toBe('runtime');
  });
});
