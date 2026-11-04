import { catalog, type Workflow } from '@onesaas/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { TableDef } from '../tables/store.js';
import type { checkWorkflow, WorkflowProblem } from '../workflows/validate.js';
import { flow1Example, flow2Example, flow4Example } from './examples.js';

/** Section 1: role and voice. Fixed text — keep verbatim. */
export const VOICE =
  'You help a small business owner turn a chore into an automation. Always call it an automation. Running a business is hard; be warm, brief and encouraging. Use plain words. Never mention JSON, ids or step types.';

/**
 * What the builder says when it runs out of tool calls. The Task 5 loop
 * enforces the cap and should reuse this exact message; the prompt states it.
 */
export const TANGLED_MESSAGE =
  "I've got a bit tangled. Can you tell me which part to focus on?";

/**
 * Maximum tool calls per request (enforced by the Task 5 loop). 30, not 20:
 * the flow 4 two-automation build (M4 Task 7) needs 19 calls minimum with zero
 * headroom for a lookup or a fix at 20 — the eval proved 20 unbuildable
 * twice (a skipped step, then a capped turn). Single automations still finish
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
    'Each step below is something the automation can do. To read an earlier step\u2019s output, bind it with {{stepId.field}} — for example {"text": "{{trigger.email.body}}"} reads the body of the email the trigger saw. A step can only read steps before it.',
    ...blocks,
  ].join('\n\n');
}

function workflowSection(workflow: Workflow, problems: WorkflowProblem[]): string {
  const lines = [
    '# The automation so far',
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
  if (tables.length === 0) return '# The owner\u2019s lists\nNone yet — create one with create_table when a step needs to save something.';
  const lines = ['# The owner\u2019s lists'];
  for (const t of tables) {
    lines.push(
      `"${t.label}" (${t.name}): ${t.columns.map((c) => `${c.label} (${c.type})`).join(', ')}.`,
    );
  }
  return lines.join('\n');
}

const EXTRACT_AND_SAVE_RULES = [
  '# When an automation reads details and saves them',
  'These rules win over the worked examples below.',
  '- Set "optional": true on every ai.extract field, so a detail the text doesn\u2019t give stays blank instead of being made up or stopping the run.',
  '- Give a new list a text column named record_id (label "Record ID"), and set "recordId": "record_id" on the save step. The step fills it with the date, the time and 3 random characters. A list that already exists without that column can\u2019t gain one, so leave recordId off for it.',
  '- If a detail identifies someone or something, such as an email address or a link, use table.upsert with it as keyField, so a repeat updates the row instead of adding another. With recordId set, a blank keyField still saves as a new row. If nothing identifies it, use table.insert.',
].join('\n');

/**
 * Whether those rules apply. A step-free automation may be about to; after that,
 * it needs a read or save step for them to mean anything.
 */
function mayExtractAndSave(workflow: Workflow): boolean {
  if (workflow.steps.length === 0) return true;
  return workflow.steps.some((s) => s.type === 'ai.extract' || s.type === 'table.insert' || s.type === 'table.upsert');
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
      '- The person you are talking to is the owner. Always call them "you": never "the owner", and never by any other name unless they tell you their name.',
      '- Talk to the owner in plain English. Never mention JSON, ids or step types to them.',
      '- Anything that sends or puts words in front of someone must stay a draft and pass through an approval step (approval.ask) first — never send for real on your own.',
      '- When you need the owner, ask one question per ask_user call, with 2 to 4 short clickable answers. You may ask follow-up questions across turns, but ask at most 3 questions per request.',
      `- You have at most ${TOOL_CALL_CAP} tool calls to finish the job. If you run out, say exactly: "${TANGLED_MESSAGE}"`,
      '- When one sentence asks for two different jobs, build the first automation first, then create_workflow and build the second in the new automation.',
      '- Every tool call already narrates itself to the owner, and every add_step result already confirms the step: never call explain while building — use it only when the owner asks what something is.',
      '- test_run is a preview: it shows what would happen without doing outside-world actions for real, and approvals auto-approve in a preview.',
      '- Reach for the code.transform calculation step only when no other step fits — for example "add 20% to the quote" or "split the full name into first and last". Its code is the body of (input) => output reading input.value, its outputFields declare what it returns, and its explanation tells the owner what it does in one plain sentence.',
    ].join('\n'),
    ...(mayExtractAndSave(o.workflow) ? [EXTRACT_AND_SAVE_RULES] : []),
    catalogSection(),
    workflowSection(o.workflow, o.problems),
    tablesSection(o.tables),
    ['# Worked examples', flow1Example, flow2Example, flow4Example].join('\n\n'),
    [
      '# About the business',
      o.business.name ? `Name: ${o.business.name}` : 'Name: (not given yet)',
      o.business.what ? `What they do: ${o.business.what}` : 'What they do: (not given yet)',
      `Timezone: ${o.business.timezone} — dates and times for the owner are in this timezone.`,
    ].join('\n'),
  ].join('\n\n');
}
