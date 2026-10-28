import { Workflow, type Workflow as WorkflowType } from '@dad/shared';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import flow1Seed from '../src/seed/flow1.json' with { type: 'json' };
import { migrateFlow1Seed } from '../src/seed/migrate.js';

// Pre-approval flow 1 shape: the M1 seed had no approve step.
const V1_SHAPE: WorkflowType = {
  id: 'flow-1',
  name: 'Save as lead & reply',
  description: 'When you click the button in Gmail, save the sender as a customer.',
  version: 1,
  status: 'on',
  trigger: {
    id: 'trigger',
    type: 'trigger.gmailButton',
    title: 'Gmail button',
    summary: 'Runs when you click the button in Gmail.',
    config: { label: '✨ Save as lead & reply' },
    inputs: {},
    position: { x: 0, y: 0 },
  },
  steps: [
    {
      id: 'draft',
      type: 'gmail.draftReply',
      title: 'Draft reply',
      summary: 'Draft the reply in Gmail.',
      config: {},
      inputs: { body: '{{write.text}}', threadId: '{{trigger.email.threadId}}' },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [{ from: 'trigger', to: 'draft' }],
};

describe('migrateFlow1Seed', () => {
  test('upgrades a pre-approval flow-1 to the next version, preserving v1', () => {
    const repo = createRepo(openDb(':memory:'));
    repo.saveWorkflow(V1_SHAPE);
    migrateFlow1Seed(repo);

    const latest = repo.getWorkflow('flow-1')!;
    expect(latest.version).toBe(2);
    expect(latest.steps.map((s) => s.id)).toEqual(['extract', 'save', 'write', 'approve', 'draft']);
    expect(latest.steps.find((s) => s.id === 'approve')?.config['question']).toBe(
      'Is this reply OK to put in Gmail?',
    );
    expect(latest.steps.find((s) => s.id === 'approve')?.inputs).toEqual({
      text: '{{write.text}}',
    });
    expect(latest.steps.find((s) => s.id === 'draft')?.inputs['body']).toBe('{{approve.text}}');

    // v1 is untouched: old runs stay pinned to the version they started on.
    const v1 = repo.getWorkflow('flow-1', 1)!;
    expect(v1.steps.some((s) => s.id === 'approve')).toBe(false);
  });

  test('is idempotent: re-running creates no further versions', () => {
    const repo = createRepo(openDb(':memory:'));
    repo.saveWorkflow(V1_SHAPE);
    migrateFlow1Seed(repo);
    migrateFlow1Seed(repo);
    expect(repo.getWorkflow('flow-1')!.version).toBe(2);
  });

  test('no-ops when flow-1 is already on the approval shape', () => {
    const repo = createRepo(openDb(':memory:'));
    repo.saveWorkflow(Workflow.parse(flow1Seed));
    migrateFlow1Seed(repo);
    expect(repo.getWorkflow('flow-1')!.version).toBe(1);
  });

  test('no-ops when flow-1 does not exist (never resurrects a deleted flow)', () => {
    const repo = createRepo(openDb(':memory:'));
    migrateFlow1Seed(repo);
    expect(repo.getWorkflow('flow-1')).toBeUndefined();
  });
});
