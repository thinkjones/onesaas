import type { StepInstance, StepRun, StepRunStatus, Workflow } from '@dad/shared';
import { buildRunStory } from '../src/engine/story.js';

function mkStep(id: string, title: string): StepInstance {
  return {
    id,
    type: 'test.step',
    title,
    summary: `${title}.`,
    config: {},
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

// Flow-1 shape: trigger→extract→save→write→draft. The draft title matches the
// plan's expected story string.
function flow1(): Workflow {
  return {
    id: 'flow-1',
    name: 'Save as lead & reply',
    description: 'story test workflow',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.gmailButton',
      title: 'Gmail button',
      summary: 'Runs when you click the button in Gmail.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [
      mkStep('extract', 'Extract details'),
      mkStep('save', 'Save to Customers'),
      mkStep('write', 'Write reply'),
      mkStep('draft', 'Draft the reply in Gmail'),
    ],
    edges: [
      { from: 'trigger', to: 'extract' },
      { from: 'extract', to: 'save' },
      { from: 'save', to: 'write' },
      { from: 'write', to: 'draft' },
    ],
  };
}

function sr(
  stepId: string,
  status: StepRunStatus,
  patch?: Partial<StepRun>,
): StepRun {
  return {
    id: `run1-${stepId}`,
    runId: 'run1',
    stepId,
    status,
    startedAt: '2026-10-28T10:00:00.000Z',
    ...patch,
  };
}

test('done flow-1 run: at most 4 lines, first starts with the trigger summary', () => {
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('extract', 'done', { why: 'Found Sarah Lee.' }),
    sr('save', 'done', { why: 'Saved Sarah Lee to Customers.' }),
    sr('write', 'done', { why: 'Wrote a warm reply.' }),
    sr('draft', 'done', { why: 'Drafted the reply in Gmail.' }),
  ];

  const story = buildRunStory(flow1(), steps);

  expect(story.length).toBeLessThanOrEqual(4);
  expect(story[0]!.startsWith('Runs when you click the button in Gmail.')).toBe(true);
  expect(story).toEqual([
    'Runs when you click the button in Gmail. → Found Sarah Lee. → Saved Sarah Lee to Customers. → Wrote a warm reply.',
    'Drafted the reply in Gmail.',
  ]);
});

test('failed run: last line is the exact stopped-at sentence', () => {
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('extract', 'done', { why: 'Found Sarah Lee.' }),
    sr('save', 'done', { why: 'Saved Sarah Lee to Customers.' }),
    sr('write', 'done', { why: 'Wrote a warm reply.' }),
    sr('draft', 'failed', { error: 'I need Gmail open in Chrome to do this.' }),
  ];

  const story = buildRunStory(flow1(), steps);

  expect(story[story.length - 1]).toBe(
    'Stopped at "Draft the reply in Gmail": I need Gmail open in Chrome to do this.',
  );
  expect(story).toEqual([
    'Runs when you click the button in Gmail. → Found Sarah Lee. → Saved Sarah Lee to Customers. → Wrote a warm reply.',
    'Stopped at "Draft the reply in Gmail": I need Gmail open in Chrome to do this.',
  ]);
});

test('waiting run ends with the exact waiting sentence', () => {
  const wf: Workflow = {
    ...flow1(),
    steps: [mkStep('write', 'Write reply'), mkStep('approve', 'Approve reply')],
    edges: [
      { from: 'trigger', to: 'write' },
      { from: 'write', to: 'approve' },
    ],
  };
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('write', 'done', { why: 'Wrote a warm reply.' }),
    sr('approve', 'waiting', { why: 'Waiting for you to approve this.' }),
  ];

  expect(buildRunStory(wf, steps)).toEqual([
    'Runs when you click the button in Gmail. → Wrote a warm reply.',
    'Waiting for you to check "Approve reply".',
  ]);
});

test('skipped steps are excluded from the story', () => {
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('extract', 'done', { why: 'Found Sarah Lee.' }),
    sr('save', 'skipped', { why: 'Skipped because an earlier step was skipped.' }),
    sr('write', 'done', { why: 'Wrote a warm reply.' }),
    sr('draft', 'done', { why: 'Drafted the reply in Gmail.' }),
  ];

  expect(buildRunStory(flow1(), steps)).toEqual([
    'Runs when you click the button in Gmail. → Found Sarah Lee. → Wrote a warm reply. → Drafted the reply in Gmail.',
  ]);
});

test('failed first step: trigger summary alone is the first line', () => {
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('extract', 'failed', { error: 'Boom' }),
    sr('save', 'pending'),
    sr('write', 'pending'),
    sr('draft', 'pending'),
  ];

  expect(buildRunStory(flow1(), steps)).toEqual([
    'Runs when you click the button in Gmail.',
    'Stopped at "Extract details": Boom',
  ]);
});

test('failed and waiting together: the waiting sentence stays last', () => {
  const wf: Workflow = {
    ...flow1(),
    steps: [mkStep('write', 'Write reply'), mkStep('approve', 'Approve reply')],
    edges: [
      { from: 'trigger', to: 'write' },
      { from: 'write', to: 'approve' },
    ],
  };
  const steps = [
    sr('trigger', 'done', { why: 'Started manually.' }),
    sr('write', 'failed', { error: 'Boom' }),
    sr('approve', 'waiting', { why: 'Waiting for you to approve this.' }),
  ];

  expect(buildRunStory(wf, steps)).toEqual([
    'Runs when you click the button in Gmail.',
    'Stopped at "Write reply": Boom',
    'Waiting for you to check "Approve reply".',
  ]);
});
