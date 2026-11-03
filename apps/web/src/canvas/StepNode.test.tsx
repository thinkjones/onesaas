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

  test('a trigger.email box carries the Gmail-open note', () => {
    const trigger: StepInstance = {
      id: 'trigger',
      type: 'trigger.email',
      title: 'New email',
      summary: 'Runs when a new customer email arrives.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    };
    const props = { id: trigger.id, data: { step: trigger, kind: 'trigger' } } as NodeProps<
      Node<StepNodeData>
    >;
    render(
      <ReactFlowProvider>
        <StepNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText('Works while Gmail is open in Chrome.')).toBeDefined();
  });

  test('other trigger boxes carry no Gmail-open note', () => {
    const trigger: StepInstance = {
      id: 'trigger',
      type: 'trigger.gmailButton',
      title: 'Gmail button',
      summary: 'Runs when you click the button in Gmail.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    };
    const props = { id: trigger.id, data: { step: trigger, kind: 'trigger' } } as NodeProps<
      Node<StepNodeData>
    >;
    render(
      <ReactFlowProvider>
        <StepNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.queryByText('Works while Gmail is open in Chrome.')).toBeNull();
  });

  test('an outcome caption renders under the status badge', () => {
    renderNode({ step: STEP, kind: 'act', status: 'done', outcome: 'Saved the lead.' });
    const caption = screen.getByText('Saved the lead.');
    expect(caption.getAttribute('data-outcome')).toBe('true');
    // The badge comes first in the card: outcome annotates, never replaces.
    const badge = screen.getByText('Done');
    expect(badge.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('no caption renders without an outcome', () => {
    const { container } = renderNode({ step: STEP, kind: 'act', status: 'done' });
    expect(container.querySelector('[data-outcome]')).toBeNull();
  });
});
