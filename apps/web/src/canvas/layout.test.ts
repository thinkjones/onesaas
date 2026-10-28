import type { StepInstance, Workflow } from '@dad/shared';
import { describe, expect, test } from 'vitest';
import { layoutWorkflow } from './layout.ts';

function step(
  id: string,
  type: string,
  title: string,
  position: { x: number; y: number },
): StepInstance {
  return {
    id,
    type,
    title,
    summary: `${title} summary.`,
    config: {},
    inputs: {},
    position,
  };
}

// Flow-1 shape: trigger → extract → save. Positions are injected per test.
function flow1(position: { x: number; y: number }): Workflow {
  return {
    id: 'flow-1',
    name: 'Save as lead & reply',
    description: 'Test flow.',
    version: 1,
    status: 'on',
    trigger: step('trigger', 'trigger.gmailButton', 'Button clicked', position),
    steps: [
      step('extract', 'ai.extract', 'Extract details', position),
      step('save', 'table.upsert', 'Save to Customers', position),
    ],
    edges: [
      { from: 'trigger', to: 'extract' },
      { from: 'extract', to: 'save' },
    ],
  };
}

function positionsOf(wf: Workflow): Record<string, { x: number; y: number }> {
  return Object.fromEntries(
    [wf.trigger, ...wf.steps].map((s) => [s.id, s.position]),
  );
}

describe('layoutWorkflow', () => {
  test('all {0,0} positions get distinct left-to-right positions', () => {
    const laid = layoutWorkflow(flow1({ x: 0, y: 0 }));
    const pos = positionsOf(laid);
    const keys = Object.values(pos).map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(3);
    expect(pos['trigger']!.x).toBeLessThan(pos['extract']!.x);
    expect(pos['extract']!.x).toBeLessThan(pos['save']!.x);
  });

  test('keeps existing non-zero positions', () => {
    const wf = flow1({ x: 0, y: 0 });
    wf.steps[0]!.position = { x: 500, y: 300 };
    const laid = layoutWorkflow(wf);
    expect(laid.steps[0]!.position).toEqual({ x: 500, y: 300 });
    // …while the unpositioned nodes still get laid out.
    const pos = positionsOf(laid);
    expect(pos['trigger']).not.toEqual({ x: 0, y: 0 });
    expect(pos['save']).not.toEqual({ x: 0, y: 0 });
  });
});
