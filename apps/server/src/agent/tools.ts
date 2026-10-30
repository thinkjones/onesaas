import { catalog, type Edge } from '@dad/shared';
import { z } from 'zod';
import type { Repo } from '../db/repo.js';
import type { createEngine } from '../engine/engine.js';
import { buildRunStory } from '../engine/story.js';
import type { TestRunResult } from '../engine/testRun.js';
import type { Gateway, ToolSpec } from '../models/gateway.js';
import { sanitiseName, type TableStore } from '../tables/store.js';
import type { OpResult, WorkflowOps } from '../workflows/ops.js';
import { checkWorkflow } from '../workflows/validate.js';

export type Engine = ReturnType<typeof createEngine>;

/** Events the builder agent emits for Dad's screen (consumed by Task 6). */
export type AgentEvent =
  | { type: 'say'; text: string }
  | { type: 'ask'; question: string; options: string[] }
  | { type: 'plan'; ghosts: { id: string; type: string; title: string; summary: string }[]; edges: Edge[] }
  | { type: 'activity'; text: string }
  | { type: 'built'; stepId: string }
  | { type: 'test'; runId: string }
  | { type: 'switched'; workflowId: string }
  | { type: 'done' };

export interface ToolContext {
  workflowId: string;
  ops: WorkflowOps;
  tables: TableStore;
  repo: Repo;
  engine: Engine;
  gateway: Gateway;
  /**
   * A test runner bound by the composition root (Task 5), which owns the
   * executors/bridge the createTestRunner factory needs. Task 3 is untouched:
   * this seam lives entirely at the tools boundary.
   */
  testRun: (workflowId: string) => Promise<TestRunResult>;
  emit(e: AgentEvent): void;
}

export interface AgentTool extends ToolSpec {
  run(args: any, ctx: ToolContext): Promise<{ result: string; endTurn?: boolean }>;
}

// Inner tools also produce their own activity line (they know the outcome);
// the wrapper below guarantees exactly one `activity` event per tool call and
// that no tool ever throws (unexpected errors become Problem results).
interface InnerOut {
  result: string;
  endTurn?: boolean;
  activity: string;
}

interface ToolImpl extends ToolSpec {
  run(args: any, ctx: ToolContext): Promise<InnerOut>;
}

function problem(error: string): InnerOut {
  return { result: `Problem: ${error}`, activity: error };
}

function opOut(res: OpResult): InnerOut {
  if (res.ok) return { result: res.note, activity: res.note };
  return problem(res.error);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toAgentTool(impl: ToolImpl): AgentTool {
  return {
    name: impl.name,
    description: impl.description,
    parameters: impl.parameters,
    run: async (args: any, ctx: ToolContext) => {
      try {
        const { activity, ...out } = await impl.run(args, ctx);
        ctx.emit({ type: 'activity', text: activity });
        return out;
      } catch (err) {
        const msg = errMsg(err);
        console.error(`[builder-tools] ${impl.name} threw unexpectedly:`, err);
        ctx.emit({ type: 'activity', text: `Something went wrong: ${msg}` });
        return { result: `Problem: ${msg}` };
      }
    },
  };
}

// Planner refinement (propose_plan): strict-mode-safe (all fields required,
// `when` nullable instead of optional — see the ai executors' all-required
// precedent). A null `when` means the edge has no condition.
const planSchema = z.object({
  steps: z.array(
    z.object({ key: z.string(), type: z.string(), title: z.string(), summary: z.string() }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string(), when: z.string().nullable() })),
});

const PLANNER_SYSTEM = [
  'You plan a chore reducer: a short chain of steps that turns a small-business chore into something automatic.',
  'Refine the proposed plan into at most 6 steps. Every step type must come from the catalog.',
  'Every edge endpoint must be a step key from your refined steps.',
  'Set "when" to null unless the edge truly needs a condition; otherwise put the plain condition there.',
  'Reply only with the plan schema.',
].join(' ');

// Ghost ids derive stably from step keys (never random): Task 6 matches later
// `built` events to ghosts by title, and stable ids keep re-proposals aligned.
function ghostId(key: string): string {
  return `ghost-${key}`;
}

interface ProposedStep {
  key: string;
  type: string;
  title: string;
  summary: string;
}

interface ProposedEdge {
  from: string;
  to: string;
  when?: string;
}

function asProposedPlan(args: any): { steps: ProposedStep[]; edges: ProposedEdge[] } | { error: string } {
  if (!args || !Array.isArray(args.steps) || args.steps.length === 0) {
    return { error: 'Give at least one step for the plan.' };
  }
  const steps: ProposedStep[] = [];
  const keys = new Set<string>();
  for (const s of args.steps) {
    if (
      !s ||
      typeof s.key !== 'string' ||
      typeof s.type !== 'string' ||
      typeof s.title !== 'string' ||
      typeof s.summary !== 'string'
    ) {
      return { error: 'Every planned step needs a key, type, title and summary.' };
    }
    if (keys.has(s.key)) return { error: `Two planned steps share the key "${s.key}".` };
    if (!catalog[s.type]) return { error: `I don't know how to do "${s.type}" yet.` };
    keys.add(s.key);
    steps.push({ key: s.key, type: s.type, title: s.title, summary: s.summary });
  }
  const edges: ProposedEdge[] = [];
  if (args.edges !== undefined) {
    if (!Array.isArray(args.edges)) return { error: 'Plan edges must be a list.' };
    for (const e of args.edges) {
      if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') {
        return { error: 'Every planned edge needs a from key and a to key.' };
      }
      if (!keys.has(e.from)) return { error: `Unknown step key in plan edges: "${e.from}".` };
      if (!keys.has(e.to)) return { error: `Unknown step key in plan edges: "${e.to}".` };
      if (e.when !== undefined && typeof e.when !== 'string') {
        return { error: 'A plan edge condition must be words.' };
      }
      edges.push({ from: e.from, to: e.to, ...(e.when ? { when: e.when } : {}) });
    }
  }
  return { steps, edges };
}

function emitPlan(
  ctx: ToolContext,
  steps: ProposedStep[],
  edges: ProposedEdge[],
): void {
  ctx.emit({
    type: 'plan',
    ghosts: steps.map((s) => ({ id: ghostId(s.key), type: s.type, title: s.title, summary: s.summary })),
    edges: edges.map(
      (e): Edge => ({ from: ghostId(e.from), to: ghostId(e.to), ...(e.when ? { when: e.when } : {}) }),
    ),
  });
}

const PLAN_RESULT = 'Plan shown to Dad; wait for his reply.';

const askUser: ToolImpl = {
  name: 'ask_user',
  description:
    'Ask Dad a question with 2 to 4 clickable answers. Use it when you cannot proceed without him. Ends your turn: his reply arrives as the next user message.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question in plain words.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 4,
        description: '2 to 4 short answers Dad can tap.',
      },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const question = args?.question as unknown;
    const options = args?.options as unknown;
    if (typeof question !== 'string' || question.trim() === '') {
      return problem('Give a question to ask.');
    }
    if (
      !Array.isArray(options) ||
      options.length < 2 ||
      options.length > 4 ||
      options.some((o) => typeof o !== 'string')
    ) {
      return problem('Give 2 to 4 text options to offer.');
    }
    ctx.emit({ type: 'ask', question, options: options as string[] });
    return {
      result: "Question asked; wait for Dad's reply.",
      endTurn: true,
      activity: `Asked Dad: ${question}`,
    };
  },
};

const proposePlan: ToolImpl = {
  name: 'propose_plan',
  description:
    'Show Dad a plan: ghost steps and how they connect, before building anything. Ends your turn: his reply arrives as the next user message.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short stable handle, e.g. "read".' },
            type: { type: 'string', description: 'Catalog step type.' },
            title: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['key', 'type', 'title', 'summary'],
          additionalProperties: false,
        },
        minItems: 1,
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source step key.' },
            to: { type: 'string', description: 'Target step key.' },
            when: { type: 'string', description: 'Condition words, when the link is conditional.' },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
    },
    required: ['steps', 'edges'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const parsed = asProposedPlan(args);
    if ('error' in parsed) return problem(parsed.error);
    let steps = parsed.steps;
    let edges = parsed.edges;
    const needsPlanner = steps.length > 6 || edges.some((e) => e.when !== undefined);
    if (needsPlanner) {
      // ToolContext carries no conversation, so the planner gets what exists:
      // the current workflow, its problems, the catalog and the proposed plan.
      const wf = ctx.repo.getWorkflow(ctx.workflowId);
      if (!wf) return problem(`Unknown workflow: ${ctx.workflowId}`);
      const refined = await ctx.gateway.chatJson({
        role: 'planner',
        system: PLANNER_SYSTEM,
        user: JSON.stringify({
          workflow: wf,
          problems: checkWorkflow(wf, ctx.tables),
          catalog: Object.values(catalog).map((d) => ({
            type: d.type,
            title: d.title,
            description: d.description,
          })),
          proposedPlan: { steps, edges },
        }),
        schema: planSchema,
        schemaName: 'plan',
      });
      // The planner's shape-checked output is not trusted: re-validate it
      // exactly like a direct proposal (dup keys, unknown types, dangling
      // edges) so a bad refinement never becomes a corrupt ghost graph.
      const revalidated = asProposedPlan({
        steps: refined.data.steps,
        edges: refined.data.edges.map((e) => ({
          from: e.from,
          to: e.to,
          ...(e.when ? { when: e.when } : {}),
        })),
      });
      if ('error' in revalidated) return problem(revalidated.error);
      steps = revalidated.steps;
      edges = revalidated.edges;
    }
    emitPlan(ctx, steps, edges);
    return {
      result: PLAN_RESULT,
      endTurn: true,
      activity: `Showed Dad a plan with ${steps.length} step${steps.length === 1 ? '' : 's'}.`,
    };
  },
};

const createTable: ToolImpl = {
  name: 'create_table',
  description: 'Create a new list (table) with named columns. Fails if a list with that name exists.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short handle, e.g. "customers".' },
      label: { type: 'string', description: 'Display name, e.g. "Customers".' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            type: {
              type: 'string',
              enum: ['text', 'number', 'boolean', 'date', 'email', 'datetime'],
            },
          },
          required: ['name', 'label', 'type'],
          additionalProperties: false,
        },
        minItems: 1,
      },
      displayField: { type: 'string', description: 'Column shown as the row title.' },
      keyField: { type: 'string', description: 'Column that identifies a row (for saving).' },
    },
    required: ['name', 'label', 'columns', 'displayField'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    try {
      const created = ctx.tables.createTable({
        name: args?.name,
        label: args?.label,
        columns: args?.columns,
        displayField: args?.displayField,
        ...(args?.keyField !== undefined ? { keyField: args.keyField } : {}),
      });
      const cols = created.columns.map((c) => c.name).join(', ');
      return {
        result: `Created list "${created.label}" with columns ${cols}.`,
        activity: `Created the "${created.label}" list.`,
      };
    } catch (err) {
      return problem(errMsg(err));
    }
  },
};

const setTrigger: ToolImpl = {
  name: 'set_trigger',
  description: 'Set what starts the chore reducer (the trigger step).',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Catalog trigger type.' },
      config: { type: 'object', description: 'Trigger settings.' },
      title: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['type', 'config'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    return opOut(
      ctx.ops.setTrigger(
        ctx.workflowId,
        {
          type: args?.type,
          config: args?.config ?? {},
          ...(args?.title !== undefined ? { title: args.title } : {}),
          ...(args?.summary !== undefined ? { summary: args.summary } : {}),
        },
        { by: 'agent' },
      ),
    );
  },
};

const addStep: ToolImpl = {
  name: 'add_step',
  description:
    'Add a step to the chore reducer. Bindings look like {{stepId.field}} and may only read steps before this one (pass "after" with an earlier step id so the step connects and can read it).',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Catalog step type.' },
      title: { type: 'string' },
      summary: { type: 'string' },
      config: { type: 'object', description: 'Step settings.' },
      inputs: {
        type: 'object',
        description: 'Input bindings, e.g. {"text": "{{trigger.email.body}}"} (keys must be strings).',
        additionalProperties: { type: 'string' },
      },
      after: { type: 'string', description: 'Earlier step id to connect after (optional).' },
    },
    required: ['type', 'title', 'summary', 'config', 'inputs'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const before = ctx.repo.getWorkflow(ctx.workflowId);
    const beforeIds = new Set(
      before ? [before.trigger.id, ...before.steps.map((s) => s.id)] : [],
    );
    const res = ctx.ops.addStep(
      ctx.workflowId,
      {
        type: args?.type,
        title: args?.title,
        summary: args?.summary,
        config: args?.config ?? {},
        inputs: args?.inputs ?? {},
        ...(args?.after !== undefined ? { after: args.after } : {}),
      },
      { by: 'agent' },
    );
    if (!res.ok) return problem(res.error);
    const added = res.workflow.steps.find((s) => !beforeIds.has(s.id));
    if (added) ctx.emit({ type: 'built', stepId: added.id });
    return { result: res.note, activity: res.note };
  },
};

const updateStep: ToolImpl = {
  name: 'update_step',
  description: 'Change a step title, summary, settings or inputs. An "inputs" value replaces all inputs.',
  parameters: {
    type: 'object',
    properties: {
      stepId: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      config: { type: 'object' },
      inputs: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['stepId'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const patch: { title?: string; summary?: string; config?: Record<string, unknown>; inputs?: Record<string, string> } = {};
    if (args?.title !== undefined) patch.title = args.title;
    if (args?.summary !== undefined) patch.summary = args.summary;
    if (args?.config !== undefined) patch.config = args.config;
    if (args?.inputs !== undefined) patch.inputs = args.inputs;
    if (Object.keys(patch).length === 0) {
      return problem('Nothing to update: give at least one of title, summary, config, inputs.');
    }
    return opOut(ctx.ops.updateStep(ctx.workflowId, args?.stepId, patch, { by: 'agent' }));
  },
};

const removeStep: ToolImpl = {
  name: 'remove_step',
  description: 'Remove a step (never the trigger). Steps that read it keep dangling bindings to fix.',
  parameters: {
    type: 'object',
    properties: { stepId: { type: 'string' } },
    required: ['stepId'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    return opOut(ctx.ops.removeStep(ctx.workflowId, args?.stepId, { by: 'agent' }));
  },
};

const connect: ToolImpl = {
  name: 'connect',
  description:
    'Connect two steps so one runs after the other. Connecting the same two steps again with "when" replaces the link with a conditional one. Refuses links that would loop.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      when: { type: 'string', description: 'Condition words for a conditional link (optional).' },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    return opOut(
      ctx.ops.connect(
        ctx.workflowId,
        {
          from: args?.from,
          to: args?.to,
          ...(args?.when !== undefined ? { when: args.when } : {}),
        },
        { by: 'agent' },
      ),
    );
  },
};

const createWorkflow: ToolImpl = {
  name: 'create_workflow',
  description:
    'Start a second chore reducer and keep building there. Use it when one sentence asks for two different jobs: finish the first reducer, then call this and build the second. Later calls in this turn target the new reducer.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name, e.g. "Photo posts".' },
      description: { type: 'string', description: 'One plain sentence saying what it does.' },
    },
    required: ['name', 'description'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const name = args?.name as unknown;
    const description = args?.description as unknown;
    if (typeof name !== 'string' || name.trim() === '') {
      return problem('Give the new chore reducer a name.');
    }
    if (typeof description !== 'string' || description.trim() === '') {
      return problem('Give the new chore reducer a description.');
    }
    const wf = ctx.ops.create({ name, description });
    // Switch the conversation's target: everything after this call in the
    // turn (including the loop's prompt rebuild) builds the new reducer.
    ctx.workflowId = wf.id;
    ctx.emit({ type: 'switched', workflowId: wf.id });
    return {
      result: `Created "${wf.name}" and switched to it. Set its trigger next.`,
      activity: `Started a new chore reducer "${wf.name}".`,
    };
  },
};

const renameWorkflow: ToolImpl = {
  name: 'rename_workflow',
  description: 'Rename the chore reducer (and optionally change its description).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    return opOut(
      ctx.ops.rename(
        ctx.workflowId,
        {
          name: args?.name,
          ...(args?.description !== undefined ? { description: args.description } : {}),
        },
        { by: 'agent' },
      ),
    );
  },
};

const testRunTool: ToolImpl = {
  name: 'test_run',
  description:
    'Try the chore reducer with a sample: a preview only, outside-world actions do not really happen. Returns one line per step.',
  parameters: { type: 'object', properties: {} },
  run: async (_args: any, ctx: ToolContext) => {
    const { run, steps } = await ctx.testRun(ctx.workflowId);
    ctx.emit({ type: 'test', runId: run.id });
    const wf = ctx.repo.getWorkflow(ctx.workflowId);
    const titleOf = (id: string): string => {
      if (wf?.trigger.id === id) return wf.trigger.title;
      return wf?.steps.find((s) => s.id === id)?.title ?? id;
    };
    const lines = steps.map((s) => {
      const title = titleOf(s.stepId);
      if (s.status === 'failed') return `${title}: failed — ${s.error ?? 'Something went wrong.'}`;
      return s.why ? `${title}: ${s.status} — ${s.why}` : `${title}: ${s.status}`;
    });
    const allDone = steps.every((s) => s.status === 'done');
    return {
      result: lines.join('\n'),
      activity: allDone ? 'Tried it — everything worked.' : 'Tried it — something needs a look.',
    };
  },
};

const activate: ToolImpl = {
  name: 'activate',
  description: 'Turn the chore reducer on so it runs on its own. Refuses while problems remain.',
  parameters: { type: 'object', properties: {} },
  run: async (_args: any, ctx: ToolContext) => {
    const res = ctx.ops.setStatus(ctx.workflowId, 'on', { by: 'agent' });
    if (!res.ok) return problem(res.error);
    ctx.emit({ type: 'done' });
    return {
      result: `Your chore reducer "${res.workflow.name}" is now on.`,
      activity: res.note,
    };
  },
};

const explain: ToolImpl = {
  name: 'explain',
  description:
    'Look up a step, run, list or workflow so you can explain it to Dad in plain words. Read-only. Dad never sees the details, only a "looked it up" note — it cannot narrate progress. While building, prefer the Links line and the lists section above: they already show step ids and columns.',

  parameters: {
    type: 'object',
    properties: {
      about: { type: 'string', enum: ['step', 'run', 'table', 'workflow'] },
      id: { type: 'string' },
    },
    required: ['about', 'id'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const about = args?.about as unknown;
    const id = args?.id as unknown;
    if (about !== 'step' && about !== 'run' && about !== 'table' && about !== 'workflow') {
      return problem('Say what to explain: step, run, table or workflow.');
    }
    if (typeof id !== 'string' || id === '') return problem('Say which one to explain.');
    const lookedUp = `Looked up ${about === 'step' ? 'a step' : about === 'run' ? 'a run' : about === 'table' ? 'a list' : 'the chore reducer'} to explain it.`;
    if (about === 'step') {
      const wf = ctx.repo.getWorkflow(ctx.workflowId);
      if (!wf) return problem(`Unknown workflow: ${ctx.workflowId}`);
      const node =
        wf.trigger.id === id ? wf.trigger : wf.steps.find((s) => s.id === id);
      if (!node) return problem(`Unknown step: ${id}`);
      return {
        result: `"${node.title}" (${node.type}): ${node.summary}\nSettings: ${JSON.stringify(node.config)}\nInputs: ${JSON.stringify(node.inputs)}`,
        activity: lookedUp,
      };
    }
    if (about === 'run') {
      const full = ctx.repo.getRun(id);
      if (!full) return problem(`Unknown run: ${id}`);
      const wf = ctx.repo.getWorkflow(full.run.workflowId, full.run.workflowVersion);
      const story = wf ? buildRunStory(wf, full.steps).join('\n') : 'The workflow version is gone.';
      return { result: `Run ${id} (${full.run.status}):\n${story}`, activity: lookedUp };
    }
    if (about === 'table') {
      const t = ctx.tables.getTable(id);
      if (!t) return problem(`Unknown table: ${id}`);
      const cols = t.columns.map((c) => `${c.name} (${c.type})`).join(', ');
      return { result: `List "${t.label}" with columns ${cols}.`, activity: lookedUp };
    }
    const w = ctx.repo.getWorkflow(id);
    if (!w) return problem(`Unknown workflow: ${id}`);
    const titles = [w.trigger.title, ...w.steps.map((s) => s.title)].join(' → ');
    return {
      result: `"${w.name}": ${w.description} Status: ${w.status}. Steps: ${titles}.`,
      activity: lookedUp,
    };
  },
};

function fmtCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const queryTable: ToolImpl = {
  name: 'query_table',
  description: 'Read rows from one of Dad\'s lists, optionally filtered. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string' },
      where: { type: 'object', description: 'Exact-match filters, e.g. {"email": "a@b.co"}.' },
      limit: { type: 'number', description: 'Maximum rows to return.' },
    },
    required: ['table'],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const table = args?.table as unknown;
    if (typeof table !== 'string' || table === '') return problem('Say which list to read.');
    try {
      // FAIL CLOSED on unknown where keys, mirroring the table.query executor:
      // the store ignores them, so a typo would silently return unfiltered rows.
      const def = ctx.tables.getTable(table);
      const where = args?.where as Record<string, unknown> | undefined;
      if (def && where !== undefined && where !== null && typeof where === 'object') {
        const names = new Set([
          ...def.columns.map((c) => c.name),
          'id',
          'created_at',
          'updated_at',
        ]);
        for (const [rawKey, value] of Object.entries(where)) {
          let col: string;
          try {
            col = sanitiseName(rawKey);
          } catch {
            return problem(`Unknown column: ${rawKey} for table ${table}`);
          }
          if (!names.has(col)) {
            return problem(`Unknown column: ${rawKey} for table ${table}`);
          }
          if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
            return problem(`Invalid where value for column ${rawKey}: operators are not supported`);
          }
        }
      }
      const rows = ctx.tables.query(table, {
        ...(args?.where !== undefined ? { where: args.where } : {}),
        ...(args?.limit !== undefined ? { limit: args.limit } : {}),
      });
      const activity = `Looked at the ${table} list.`;
      if (rows.length === 0) return { result: 'No rows found.', activity };
      const lines = rows.map((row) =>
        Object.entries(row)
          .filter(([k]) => k !== 'created_at' && k !== 'updated_at')
          .map(([k, v]) => `${k}=${fmtCell(v)}`)
          .join(', '),
      );
      return { result: lines.join('\n'), activity };
    } catch (err) {
      return problem(errMsg(err));
    }
  },
};

const queryRuns: ToolImpl = {
  name: 'query_runs',
  description: 'Find past runs (newest first), optionally those whose story mentions some words. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      contains: { type: 'string', description: 'Words the run story must mention.' },
      limit: { type: 'number', description: 'Maximum runs to return (default 5).' },
    },
    required: [],
    additionalProperties: false,
  },
  run: async (args: any, ctx: ToolContext) => {
    const contains = typeof args?.contains === 'string' ? args.contains : undefined;
    const limit = args?.limit ?? 5;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
      return problem(`Invalid limit: ${args?.limit}`);
    }
    const runs = ctx.repo.listRuns({ includeTests: true, workflowId: ctx.workflowId });
    const hits: string[] = [];
    for (const r of runs) {
      if (hits.length >= limit) break;
      const full = ctx.repo.getRun(r.id);
      if (!full) continue;
      const wf = ctx.repo.getWorkflow(r.workflowId, r.workflowVersion);
      if (!wf) continue;
      const story = buildRunStory(wf, full.steps);
      if (contains && !story.join('\n').toLowerCase().includes(contains.toLowerCase())) continue;
      hits.push(`${r.id}: ${story.join(' | ')}`);
    }
    if (hits.length === 0) return { result: 'No runs found.', activity: 'Looked through past runs.' };
    return { result: hits.join('\n'), activity: 'Looked through past runs.' };
  },
};

/** The builder agent's tools (consumed by the Task 5 loop). */
export const builderTools: AgentTool[] = [
  askUser,
  proposePlan,
  createTable,
  setTrigger,
  addStep,
  updateStep,
  removeStep,
  connect,
  createWorkflow,
  renameWorkflow,
  testRunTool,
  activate,
  explain,
  queryTable,
  queryRuns,
].map(toAgentTool);
