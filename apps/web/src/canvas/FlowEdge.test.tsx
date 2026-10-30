import type { Edge, EdgeProps } from '@xyflow/react';
import { ReactFlowProvider } from '@xyflow/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import FlowEdge, { type FlowEdgeData } from './FlowEdge.tsx';

// EdgeLabelRenderer portals into the canvas viewport, which only a full
// ReactFlow mounts: render its children inline so the pill and popover are
// testable around a lone edge.
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const POSITION = {
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: 'right',
  targetPosition: 'left',
} as unknown as Pick<EdgeProps, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'>;

function renderEdge(data: FlowEdgeData, source = 'classify', target = 'extract') {
  const props = {
    id: `${source}->${target}`,
    source,
    target,
    data,
    ...POSITION,
  } as EdgeProps<Edge<FlowEdgeData>>;
  return render(
    <ReactFlowProvider>
      <svg>
        <FlowEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

function designCondition(onConnect: (when: string) => void): FlowEdgeData['condition'] {
  return { stepId: 'classify', options: ['yes', 'no'], onConnect };
}

describe('FlowEdge condition pill', () => {
  test('a sort condition shows as "Only if: yes"', () => {
    renderEdge({ when: "classify.choice == 'yes'" });
    expect(screen.getByText('Only if: yes')).toBeDefined();
  });

  test('a condition on another field shows its raw text', () => {
    renderEdge({ when: 'freebusy.free == false' });
    expect(screen.getByText('freebusy.free == false')).toBeDefined();
  });

  test('no pill without a condition', () => {
    const { container } = renderEdge({});
    expect(container.querySelector('.react-flow__edge-path')).toBeDefined();
    expect(screen.queryByText(/Only if:/)).toBeNull();
  });
});

describe('FlowEdge condition editing', () => {
  test('clicking the pill opens the "Only continue when…" picker', () => {
    renderEdge({
      when: "classify.choice == 'yes'",
      condition: designCondition(vi.fn()),
    });
    fireEvent.click(screen.getByText('Only if: yes'));
    expect(screen.getByText('Only continue when…')).toBeDefined();
    expect(screen.getByRole('button', { name: 'yes' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'no' })).toBeDefined();
  });

  test('clicking the edge itself opens the picker when there is no pill yet', () => {
    const { container } = renderEdge({ condition: designCondition(vi.fn()) });
    expect(screen.queryByText('Only continue when…')).toBeNull();
    fireEvent.click(container.querySelector('.react-flow__edge-path')!);
    expect(screen.getByText('Only continue when…')).toBeDefined();
  });

  test('picking an option calls connect with the condition and closes', () => {
    const onConnect = vi.fn();
    renderEdge({
      when: "classify.choice == 'yes'",
      condition: designCondition(onConnect),
    });
    fireEvent.click(screen.getByText('Only if: yes'));
    fireEvent.click(screen.getByRole('button', { name: 'no' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith("classify.choice == 'no'");
    expect(screen.queryByText('Only continue when…')).toBeNull();
  });

  test('editing pins the exact condition syntax', () => {
    const onConnect = vi.fn();
    const { container } = renderEdge({ condition: designCondition(onConnect) });
    fireEvent.click(container.querySelector('.react-flow__edge-path')!);
    fireEvent.click(screen.getByRole('button', { name: 'yes' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith("classify.choice == 'yes'");
  });

  test('no picker outside design mode', () => {
    renderEdge({ when: "classify.choice == 'yes'" });
    fireEvent.click(screen.getByText('Only if: yes'));
    expect(screen.queryByText('Only continue when…')).toBeNull();
  });
});
