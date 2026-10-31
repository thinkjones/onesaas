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
  test('lays the graph top-down with distinct positions', () => {
    const laid = layoutWorkflow(flow1({ x: 0, y: 0 }));
    const pos = positionsOf(laid);
    const keys = Object.values(pos).map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(3);
    expect(pos['trigger']!.y).toBeLessThan(pos['extract']!.y);
    expect(pos['extract']!.y).toBeLessThan(pos['save']!.y);
  });

  test('always re-lays out: saved positions are not preserved', () => {
    // Nodes are not draggable (Bug #4), so there are no user positions to
    // keep — the whole graph is laid out every time.
    const wf = flow1({ x: 0, y: 0 });
    wf.steps[0]!.position = { x: 500, y: 300 };
    const laid = layoutWorkflow(wf);
    const pos = positionsOf(laid);
    expect(pos['extract']).not.toEqual({ x: 500, y: 300 });
    expect(pos['trigger']!.y).toBeLessThan(pos['extract']!.y);
    expect(pos['extract']!.y).toBeLessThan(pos['save']!.y);
  });

  test('layout is deterministic: same graph, same positions', () => {
    const a = positionsOf(layoutWorkflow(flow1({ x: 0, y: 0 })));
    const b = positionsOf(layoutWorkflow(flow1({ x: 100, y: 900 })));
    expect(a).toEqual(b);
  });
});
