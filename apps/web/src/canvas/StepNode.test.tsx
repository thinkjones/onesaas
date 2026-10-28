import type { StepInstance } from '@dad/shared';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StepNode, { type StepNodeData } from './StepNode.tsx';

const STEP: StepInstance = {
  id: 'approve',
  type: 'approval.ask',
  title: 'Check the reply',
  summary: 'Dad checks the reply before it is drafted.',
  config: {},
  inputs: {},
  position: { x: 0, y: 0 },
};

function renderNode(data: StepNodeData) {
  const props = { id: STEP.id, data } as NodeProps<Node<StepNodeData>>;
  return render(
    <ReactFlowProvider>
      <StepNode {...props} />
    </ReactFlowProvider>,
  );
}

describe('StepNode', () => {
  test('waiting status shows "Waiting for you" with data-status="waiting"', () => {
    renderNode({ step: STEP, kind: 'act', status: 'waiting' });
    const badge = screen.getByText('Waiting for you');
    expect(badge.getAttribute('data-status')).toBe('waiting');
    const node = screen.getByText('Check the reply').closest('[data-step-id]');
    expect(node?.getAttribute('data-step-id')).toBe('approve');
    expect(node?.getAttribute('data-status')).toBe('waiting');
  });

  test('renders kind icon, title and summary without a status', () => {
    renderNode({ step: STEP, kind: 'act' });
    expect(screen.getByText('Check the reply')).toBeDefined();
    expect(screen.getByText('Dad checks the reply before it is drafted.')).toBeDefined();
    expect(screen.queryByText('Waiting for you')).toBeNull();
  });
});
