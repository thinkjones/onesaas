import type { StepInstance } from '@onesaas/shared';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StepNode, { type StepNodeData } from './StepNode.tsx';

const STEP: StepInstance = {
  id: 'approve',
  type: 'approval.ask',
  title: 'Check the reply',
  summary: 'The owner checks the reply before it is drafted.',
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
  test('renders kind icon, title and summary without a status', () => {
    renderNode({ step: STEP, kind: 'act' });
    expect(screen.getByText('Check the reply')).toBeDefined();
    expect(screen.getByText('The owner checks the reply before it is drafted.')).toBeDefined();
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

  test('in Runs a finished step leads with what happened', () => {
    renderNode({ step: STEP, kind: 'act', status: 'done', runs: true, number: 3, outcome: 'Saved the lead.' });
    expect(screen.getByText('Saved the lead.').getAttribute('data-outcome')).toBe('true');
    expect(screen.getByText(`3 · ${STEP.title}`)).toBeDefined();
  });

  test('in Runs a step not reached says so', () => {
    renderNode({ step: STEP, kind: 'act', runs: true });
    expect(screen.getByText('Not started.')).toBeDefined();
  });

  test('a waiting step grows in place to hold its card', () => {
    renderNode({ step: STEP, kind: 'act', status: 'waiting', runs: true, expanded: <p>Check this</p> });
    expect(screen.getByText('Waiting for you')).toBeDefined();
    expect(screen.getByText('Check this').closest('.step-expanded')).not.toBeNull();
  });

  test('design cards show no run details', () => {
    const { container } = renderNode({ step: STEP, kind: 'act' });
    expect(container.querySelector('[data-outcome]')).toBeNull();
  });
});
