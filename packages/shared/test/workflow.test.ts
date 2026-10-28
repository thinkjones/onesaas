import { Workflow, topoOrder } from '../src/index.js';
import type { StepInstance } from '../src/index.js';

function step(id: string): StepInstance {
  return { id, type: 'test', title: id, summary: '', config: {}, inputs: {}, position: { x: 0, y: 0 } };
}

function workflowWithEdges(edges: { from: string; to: string }[]) {
  return {
    id: 'wf1',
    name: 'wf',
    description: '',
    version: 1,
    status: 'draft' as const,
    trigger: step('trigger'),
    steps: [step('a'), step('b'), step('c')],
    edges,
  };
}

test('topoOrder puts trigger first and respects edges', () => {
  const wf = Workflow.parse(
    workflowWithEdges([
      { from: 'trigger', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'trigger', to: 'c' },
    ]),
  );
  const order = topoOrder(wf);
  expect(order[0]).toBe('trigger');
  expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  expect([...order].sort()).toEqual(['a', 'b', 'c', 'trigger']);
});

test('topoOrder throws on a cycle', () => {
  const wf = Workflow.parse(workflowWithEdges([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]));
  expect(() => topoOrder(wf)).toThrow('Workflow has a cycle');
});

test('Workflow rejects an edge whose from is not a step or trigger id', () => {
  const bad = workflowWithEdges([{ from: 'nope', to: 'a' }]);
  expect(() => Workflow.parse(bad)).toThrow();
});

test('Workflow rejects two steps sharing an id', () => {
  const wf = workflowWithEdges([]);
  wf.steps = [step('a'), step('a'), step('c')];
  expect(() => Workflow.parse(wf)).toThrow('Duplicate step id: a');
});

test('Workflow rejects a step colliding with the trigger id', () => {
  const wf = workflowWithEdges([]);
  wf.steps = [step('a'), step('trigger'), step('c')];
  expect(() => Workflow.parse(wf)).toThrow('Duplicate step id: trigger');
});
