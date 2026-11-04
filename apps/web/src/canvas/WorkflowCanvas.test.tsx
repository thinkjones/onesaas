import type { StepInstance, Workflow } from '@onesaas/shared';
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

describe('WorkflowCanvas condition editing', () => {
  function sortFlow(): Workflow {
    const classify: StepInstance = {
      id: 'classify',
      type: 'ai.classify',
      title: 'Sort',
      summary: 'Sort.',
      config: { question: 'Booking?', options: ['yes', 'no'] },
      inputs: {},
      position: { x: 300, y: 200 },
    };
    return {
      ...WF,
      steps: [classify, step('extract', { x: 500, y: 300 })],
      edges: [
        { from: 'trigger', to: 'classify' },
        { from: 'classify', to: 'extract', when: "classify.choice == 'yes'" },
      ],
    };
  }

  test('a wire out of a sort step carries the picker; picking emits connect with when', () => {
    const onChange = vi.fn();
    render(
      <WorkflowCanvas workflow={sortFlow()} mode="design" onSelectStep={() => {}} onChange={onChange} />,
    );
    const edges = lastFlowProps().edges!;
    const wire = edges.find((e) => e.id === 'classify->extract')!;
    const condition = (wire.data as { condition: { stepId: string; options: string[]; onConnect(when: string): void } })
      .condition;
    expect(condition.stepId).toBe('classify');
    expect(condition.options).toEqual(['yes', 'no']);
    act(() => {
      condition.onConnect("classify.choice == 'no'");
    });
    expect(onChange).toHaveBeenCalledWith({
      op: 'connect',
      from: 'classify',
      to: 'extract',
      when: "classify.choice == 'no'",
    });
  });

  test('no picker on other wires or in runtime mode', () => {
    const onChange = vi.fn();
    render(
      <WorkflowCanvas workflow={sortFlow()} mode="design" onSelectStep={() => {}} onChange={onChange} />,
    );
    const designEdges = lastFlowProps().edges!;
    expect(
      (designEdges.find((e) => e.id === 'trigger->classify')!.data as object),
    ).not.toHaveProperty('condition');

    render(
      <WorkflowCanvas
        workflow={sortFlow()}
        mode="runtime"
        onSelectStep={() => {}}
        onChange={onChange}
      />,
    );
    const runtimeEdges = lastFlowProps().edges!;
    expect(
      (runtimeEdges.find((e) => e.id === 'classify->extract')!.data as object),
    ).not.toHaveProperty('condition');
  });
});

describe('WorkflowCanvas node outcomes', () => {
  test('renderNodeOutcome flows into node data per step', () => {
    render(
      <WorkflowCanvas
        workflow={WF}
        mode="runtime"
        onSelectStep={() => {}}
        renderNodeOutcome={(stepId) => (stepId === 'extract' ? 'Saved the lead.' : undefined)}
      />,
    );
    const nodes = lastFlowProps().nodes!;
    const extract = nodes.find((n) => n.id === 'extract')!;
    expect((extract.data as { outcome?: string }).outcome).toBe('Saved the lead.');
    const trigger = nodes.find((n) => n.id === 'trigger')!;
    expect((trigger.data as { outcome?: string }).outcome).toBeUndefined();
  });

  test('nodes carry no outcome without the seam', () => {
    render(<WorkflowCanvas workflow={WF} mode="runtime" onSelectStep={() => {}} />);
    const nodes = lastFlowProps().nodes!;
    expect((nodes.find((n) => n.id === 'extract')!.data as { outcome?: string }).outcome).toBeUndefined();
  });
});
