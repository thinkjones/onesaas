import type { StepInstance, Workflow } from '@dad/shared';
import type { ReactFlowProps } from '@xyflow/react';
import { ReactFlow } from '@xyflow/react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import WorkflowCanvas from './WorkflowCanvas.tsx';

// Capture the props WorkflowCanvas passes to ReactFlow so tests can drive
// onNodesChange directly (no full drag simulation needed).
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return { ...actual, ReactFlow: vi.fn(() => null) };
});

const ReactFlowMock = ReactFlow as unknown as ReturnType<typeof vi.fn>;

function step(id: string, position: { x: number; y: number }): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title: id,
    summary: `${id} summary.`,
    config: {},
    inputs: {},
    position,
  };
}

const WF: Workflow = {
  id: 'flow-1',
  name: 'Test flow',
  description: 'Test flow.',
  version: 1,
  status: 'on',
  trigger: step('trigger', { x: 100, y: 100 }),
  steps: [step('extract', { x: 500, y: 300 })],
  edges: [{ from: 'trigger', to: 'extract' }],
};

function lastFlowProps(): ReactFlowProps {
  const calls = ReactFlowMock.mock.calls;
  return calls[calls.length - 1]![0] as ReactFlowProps;
}

beforeEach(() => {
  ReactFlowMock.mockClear();
});

describe('WorkflowCanvas move op', () => {
  test('drag sequence emits exactly one move op with the final position', () => {
    const onChange = vi.fn();
    render(<WorkflowCanvas workflow={WF} mode="design" onSelectStep={() => {}} onChange={onChange} />);
    const onNodesChange = lastFlowProps().onNodesChange!;

    // Intermediate per-frame changes carry dragging: true; the final drop
    // change carries dragging: false (@xyflow/react 12 semantics).
    act(() => {
      onNodesChange([{ id: 'extract', type: 'position', position: { x: 510, y: 305 }, dragging: true }]);
    });
    act(() => {
      onNodesChange([{ id: 'extract', type: 'position', position: { x: 520, y: 310 }, dragging: true }]);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      onNodesChange([{ id: 'extract', type: 'position', position: { x: 525, y: 315 }, dragging: false }]);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      op: 'move',
      stepId: 'extract',
      position: { x: 525, y: 315 },
    });
  });

  test('runtime mode emits no move op even on drop', () => {
    const onChange = vi.fn();
    render(<WorkflowCanvas workflow={WF} mode="runtime" onSelectStep={() => {}} onChange={onChange} />);
    act(() => {
      lastFlowProps().onNodesChange!([
        { id: 'extract', type: 'position', position: { x: 525, y: 315 }, dragging: false },
      ]);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
