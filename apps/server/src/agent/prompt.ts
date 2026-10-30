import { catalog, type Workflow } from '@dad/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { TableDef } from '../tables/store.js';
import type { checkWorkflow, WorkflowProblem } from '../workflows/validate.js';
import { flow1Example, flow2Example, flow4Example } from './examples.js';

/** Section 1: role and voice. Fixed text — keep verbatim. */
export const VOICE =
  'You help a small business owner turn a chore into a chore reducer. Running a business is hard; be warm, brief and encouraging. Use plain words. Never mention JSON, ids or step types.';

/**
 * What the builder says when it runs out of tool calls. The Task 5 loop
 * enforces the cap and should reuse this exact message; the prompt states it.
 */
export const TANGLED_MESSAGE =
  "I've got a bit tangled. Can you tell me which part to focus on?";

/**
 * Maximum tool calls per request (enforced by the Task 5 loop). 30, not 20:
 * the flow 4 two-reducer build (M4 Task 7) needs 19 calls minimum with zero
 * headroom for a lookup or a fix at 20 — the eval proved 20 unbuildable
 * twice (a skipped step, then a capped turn). Single reducers still finish
 * far below this.
 */
export const TOOL_CALL_CAP = 30;

function catalogSection(): string {
  const blocks = Object.values(catalog).map((def) => {
    const config = JSON.stringify(zodToJsonSchema(def.configSchema));
    const input = JSON.stringify(zodToJsonSchema(def.inputSchema));
    const output = JSON.stringify(zodToJsonSchema(def.outputSchema));
    return [
      `## ${def.type} — ${def.title}`,
      def.description,
      `Settings shape: ${config}`,
      `Inputs shape: ${input}`,
      `Output shape: ${output}`,
    ].join('\n');
  });
  return [
    '# What you can build with',
    'Each step below is something the chore reducer can do. To read an earlier step\u2019s output, bind it with {{stepId.field}} — for example {"text": "{{trigger.email.body}}"} reads the body of the email the trigger saw. A step can only read steps before it.',
    ...blocks,
  ].join('\n\n');
}

function workflowSection(workflow: Workflow, problems: WorkflowProblem[]): string {
  const lines = [
    '# The chore reducer so far',
    `Name: ${workflow.name}`,
    `Description: ${workflow.description}`,
    `Status: ${workflow.status}`,
    `Trigger: "${workflow.trigger.title}" (${workflow.trigger.type}) — ${workflow.trigger.summary}`,
  ];
  for (const s of workflow.steps) {
    lines.push(
      `Step "${s.title}" (${s.type}) — ${s.summary} Settings: ${JSON.stringify(s.config)} Inputs: ${JSON.stringify(s.inputs)}`,
    );
  }
  lines.push(
    workflow.edges.length === 0
      ? 'Links: none yet.'
      : `Links: ${workflow.edges.map((e) => (e.when ? `${e.from} → ${e.to} when ${e.when}` : `${e.from} → ${e.to}`)).join(', ')}.`,
  );
  lines.push(
    problems.length === 0
      ? 'Problems: none — it can be turned on.'
      : `Problems to fix:\n${problems.map((p) => `- ${p.stepId}: ${p.problem}`).join('\n')}`,
  );
  return lines.join('\n');
}

function tablesSection(tables: TableDef[]): string {
  if (tables.length === 0) return '# Dad\u2019s lists\nNone yet — create one with create_table when a step needs to save something.';
  const lines = ['# Dad\u2019s lists'];
  for (const t of tables) {
    lines.push(
      `"${t.label}" (${t.name}): ${t.columns.map((c) => `${c.label} (${c.type})`).join(', ')}.`,
    );
  }
  return lines.join('\n');
}

export function buildSystemPrompt(o: {
  business: { name?: string; what?: string; timezone: string };
  workflow: Workflow;
  problems: ReturnType<typeof checkWorkflow>;
  tables: TableDef[];
}): string {
  return [
    VOICE,
    [
      '# Rules',
      '- Talk to Dad in plain English. Never mention JSON, ids or step types to him.',
      '- Anything that sends or puts words in front of someone must stay a draft and pass through an approval step (approval.ask) first — never send for real on your own.',
      '- When you need Dad, ask one question per ask_user call, with 2 to 4 short clickable answers. You may ask follow-up questions across turns, but ask at most 3 questions per request.',
      `- You have at most ${TOOL_CALL_CAP} tool calls to finish the job. If you run out, say exactly: "${TANGLED_MESSAGE}"`,
      '- When one sentence asks for two different jobs, build the first reducer first, then create_workflow and build the second in the new reducer.',
      '- Every tool call already narrates itself to Dad, and every add_step result already confirms the step: never call explain while building — use it only when Dad asks what something is.',
      '- test_run is a preview: it shows what would happen without doing outside-world actions for real, and approvals auto-approve in a preview.',
    ].join('\n'),
    catalogSection(),
    workflowSection(o.workflow, o.problems),
    tablesSection(o.tables),
    ['# Worked examples', flow1Example, flow2Example, flow4Example].join('\n\n'),
    [
      '# About the business',
      o.business.name ? `Name: ${o.business.name}` : 'Name: (not given yet)',
      o.business.what ? `What they do: ${o.business.what}` : 'What they do: (not given yet)',
      `Timezone: ${o.business.timezone} — dates and times for Dad are in this timezone.`,
    ].join('\n'),
  ].join('\n\n');
}
