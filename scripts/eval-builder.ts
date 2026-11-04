// Builder eval (M3 Task 5, NOT a test gate): drives the real builder agent
// against the live model and checks it builds the flow 1 customer-email flow
// and the flow 2 booking flow. Run from the repo root:
// pnpm tsx scripts/eval-builder.ts
// Needs MODEL_API_KEY in the environment. Each case gets a fresh :memory:
// DB — never the live app.db. Exit code is 0 on PASS, 1 on FAIL. Prints
// PASS/FAIL per flow plus the tool calls made and the model cost.
import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
// Relative, not '@onesaas/shared': the workspace link only exists under
// apps/server/node_modules, so the bare specifier fails from scripts/ at both
// typecheck and tsx runtime. (Shared's own main IS this src entry.)
import { catalog, type Workflow } from '../packages/shared/src/index.js';
import { createConversationStore } from '../apps/server/src/agent/conversations.js';
import { flow2ExampleUser, flow4ExampleUser } from '../apps/server/src/agent/examples.js';
import { createBuilderAgent } from '../apps/server/src/agent/loop.js';
import type { AgentEvent } from '../apps/server/src/agent/tools.js';
import { openDb } from '../apps/server/src/db/connection.js';
import { createRepo } from '../apps/server/src/db/repo.js';
import { createEngine } from '../apps/server/src/engine/engine.js';
import { createTestRunner } from '../apps/server/src/engine/testRun.js';
import { createGateway, type Gateway } from '../apps/server/src/models/gateway.js';
import { executors, type Bridge } from '../apps/server/src/steps/registry.js';
import { createTableStore, type TableStore } from '../apps/server/src/tables/store.js';
import { checkWorkflow } from '../apps/server/src/workflows/validate.js';
import { createWorkflowOps } from '../apps/server/src/workflows/ops.js';

const FLOW1_SEND =
  'When a customer emails me, save them in my customer list and draft a friendly reply for me to check.';
const MAX_SENDS = 10;
const COST_CAP_USD = 2;

const FLOW1_STEPS = ['ai.extract', 'table.upsert', 'ai.write', 'approval.ask', 'gmail.draftReply'];
const FLOW2_STEPS = [
  'gmail.read',
  'ai.classify',
  'ai.extract',
  'calendar.freeBusy',
  'table.insert',
  'calendar.createEvent',
  'ai.write',
  'approval.ask',
  'gmail.draftReply',
];

// Flow 4 (M4 Task 7): the email branch is flow 1 plus the new-customer check;
// the photo branch prepares the Meta post. The photo branch's row-shaping
// ai.extract is build detail, not a required step (presence checks stay
// lenient so equivalent shapings pass).
const FLOW4_EMAIL_STEPS = [
  'ai.extract',
  'table.query',
  'ai.classify',
  'notify',
  'table.upsert',
  'ai.write',
  'approval.ask',
  'gmail.draftReply',
];
const FLOW4_PHOTO_STEPS = [
  'image.cutout',
  'image.generate',
  'ai.write',
  'table.insert',
  'approval.ask',
  'meta.draftPost',
];

function setupCustomers(tables: TableStore): void {
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'need', label: 'Need', type: 'text' },
      { name: 'urgency', label: 'Urgency', type: 'text' },
    ],
    displayField: 'name',
    keyField: 'email',
  });
}

function emptyCheck(
  built: Workflow,
  tables: TableStore,
): [string, boolean] {
  const problems = checkWorkflow(built, tables);
  return [
    problems.length === 0
      ? 'checkWorkflow empty'
      : `checkWorkflow: ${problems.map((p) => `${p.stepId}: ${p.problem}`).join('; ')}`,
    problems.length === 0,
  ];
}

interface EvalCase {
  name: string;
  firstSend: string;
  setupTables(tables: TableStore): void;
  /** Single-workflow checks (flows 1-2). */
  checks?: (built: Workflow, tables: TableStore) => [string, boolean][];
  /** Multi-workflow checks (flow 4): run against every workflow instead. */
  checksAll?: (workflows: Workflow[], tables: TableStore) => [string, boolean][];
}

function setupPosts(tables: TableStore): void {
  tables.createTable({
    name: 'posts',
    label: 'Posts',
    columns: [
      { name: 'caption', label: 'Caption', type: 'text' },
      { name: 'image', label: 'Image', type: 'text' },
    ],
    displayField: 'caption',
  });
}

/** The workflow with the most `want` step types (ties: first listed). */
function bestMatch(workflows: Workflow[], want: string[]): Workflow | undefined {
  let best: Workflow | undefined;
  let bestHits = -1;
  for (const wf of workflows) {
    const types = wf.steps.map((s) => s.type);
    const hits = want.filter((t) => types.includes(t)).length;
    if (hits > bestHits) {
      best = wf;
      bestHits = hits;
    }
  }
  return bestHits > 0 ? best : undefined;
}

const CASES: EvalCase[] = [
  {
    name: 'flow 1 (customer email)',
    firstSend: FLOW1_SEND,
    setupTables: setupCustomers,
    checks: (built, tables) => {
      const stepTypes = built.steps.map((s) => s.type);
      return [
        [
          `trigger is ${built.trigger.type} (want trigger.gmailButton or trigger.email)`,
          built.trigger.type === 'trigger.gmailButton' || built.trigger.type === 'trigger.email',
        ],
        ...FLOW1_STEPS.map((t): [string, boolean] => [`step ${t} present`, stepTypes.includes(t)]),
        emptyCheck(built, tables),
      ];
    },
  },
  {
    name: 'flow 2 (booking)',
    firstSend: flow2ExampleUser,
    // The builder creates the Bookings list itself via create_table.
    setupTables: () => {},
    checks: (built, tables) => {
      const stepTypes = built.steps.map((s) => s.type);
      const classify = built.steps.find((s) => s.type === 'ai.classify');
      const extract = built.steps.find((s) => s.type === 'ai.extract');
      const wantWhen = classify ? `${classify.id}.choice == 'yes'` : '(no classify step)';
      const edgeOk =
        classify !== undefined &&
        extract !== undefined &&
        built.edges.some((e) => e.from === classify.id && e.to === extract.id && e.when === wantWhen);
      return [
        [
          `trigger is ${built.trigger.type} (want trigger.email)`,
          built.trigger.type === 'trigger.email',
        ],
        ...FLOW2_STEPS.map((t): [string, boolean] => [`step ${t} present`, stepTypes.includes(t)]),
        [`conditional edge with when ${wantWhen}`, edgeOk],
        emptyCheck(built, tables),
      ];
    },
  },
  {
    name: 'flow 4 (new customer + photo post)',
    firstSend: flow4ExampleUser,
    // Both lists pre-exist (the worked example teaches skipping
    // create_table when the lists section already shows them): the 19-call
    // build has one call of headroom under the 20-call cap, so the eval
    // must not spend calls on table setup.
    setupTables: (tables) => {
      setupCustomers(tables);
      setupPosts(tables);
    },
    checksAll: (workflows, tables) => {
      const email = bestMatch(workflows, FLOW4_EMAIL_STEPS);
      // One automation matching both branches is a single-automation build, not
      // flow 4: the photo automation must be a SEPARATE workflow.
      let photo = bestMatch(workflows, FLOW4_PHOTO_STEPS);
      if (photo && email && photo.id === email.id) photo = undefined;
      const out: [string, boolean][] = [
        [`two automations built (found ${workflows.length})`, workflows.length >= 2],
        ['email automation found', email !== undefined],
        ['photo automation found', photo !== undefined],
      ];
      if (email) {
        const stepTypes = email.steps.map((s) => s.type);
        out.push([
          `email trigger is ${email.trigger.type} (want trigger.gmailButton or trigger.email)`,
          email.trigger.type === 'trigger.gmailButton' || email.trigger.type === 'trigger.email',
        ]);
        for (const t of FLOW4_EMAIL_STEPS) {
          out.push([`email step ${t} present`, stepTypes.includes(t)]);
        }
        const classify = email.steps.find((s) => s.type === 'ai.classify');
        const flag = email.steps.find((s) => s.type === 'notify');
        const wantWhen = classify ? `${classify.id}.choice == 'yes'` : '(no classify step)';
        out.push([
          `conditional edge to notify with when ${wantWhen}`,
          classify !== undefined &&
            flag !== undefined &&
            email.edges.some((e) => e.from === classify.id && e.to === flag.id && e.when === wantWhen),
        ]);
        const [label, ok] = emptyCheck(email, tables);
        out.push([`email ${label}`, ok]);
      }
      if (photo) {
        const stepTypes = photo.steps.map((s) => s.type);
        out.push([
          `photo trigger is ${photo.trigger.type} (want trigger.upload)`,
          photo.trigger.type === 'trigger.upload',
        ]);
        for (const t of FLOW4_PHOTO_STEPS) {
          out.push([`photo step ${t} present`, stepTypes.includes(t)]);
        }
        const [label, ok] = emptyCheck(photo, tables);
        out.push([`photo ${label}`, ok]);
      }
      return out;
    },
  },
];

interface CaseResult {
  ok: boolean;
  sends: number;
  toolCalls: string[];
  costUsd: number;
  reason: string;
}

async function runCase(c: EvalCase, gateway: Gateway, track: () => { toolCalls: string[]; costUsd: number }): Promise<CaseResult> {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  c.setupTables(tables);
  const repo = createRepo(db);
  const conversations = createConversationStore(db);
  const agentEvents = new EventEmitter();

  // No extension is connected in the eval: email-trigger test runs fall back
  // to the catalog sample (readLiveEmail treats every bridge failure as "no
  // open email").
  const bridge: Bridge = {
    call: async () => {
      throw new Error('no bridge in eval');
    },
  };
  const engine = createEngine({ repo, executors, ctx: { gateway, tables, bridge } });
  const ops = createWorkflowOps({ repo, tables, catalog });
  const { testRun } = createTestRunner({ repo, executors, ctx: { gateway, tables, bridge } });
  const agent = createBuilderAgent({
    gateway,
    ops,
    tables,
    repo,
    engine,
    events: agentEvents,
    conversations,
    testRun,
  });

  const wf = ops.create({ name: 'Eval chore', description: 'Built by the eval.' });

  let pending: string | null = c.firstSend;
  let sends = 0;
  try {
    while (pending !== null) {
      sends += 1;
      if (sends > MAX_SENDS) {
        const t = track();
        return { ok: false, sends, toolCalls: [...t.toolCalls], costUsd: t.costUsd, reason: `still going after ${MAX_SENDS} sends` };
      }
      const turnEvents: AgentEvent[] = [];
      const onEvent = (e: { event: AgentEvent }): void => {
        turnEvents.push(e.event);
      };
      agentEvents.on('event', onEvent);
      try {
        await agent.send(wf.id, pending);
      } finally {
        agentEvents.off('event', onEvent);
      }
      const t = track();
      if (t.costUsd > COST_CAP_USD) {
        return { ok: false, sends, toolCalls: [...t.toolCalls], costUsd: t.costUsd, reason: `over the $${COST_CAP_USD} cost cap` };
      }
      pending = null;
      for (const e of turnEvents) {
        if (e.type === 'ask') pending = e.options[0] ?? null;
        if (e.type === 'plan') pending = 'Yes, build it';
      }
    }
  } catch (err) {
    const t = track();
    return {
      ok: false,
      sends,
      toolCalls: [...t.toolCalls],
      costUsd: t.costUsd,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const built = repo.getWorkflow(wf.id)!;
  const checks = c.checksAll
    ? c.checksAll(repo.listWorkflows(), tables)
    : c.checks!(built, tables);
  for (const [label, ok] of checks) console.log(`  ${ok ? 'ok' : 'MISSING'}: ${label}`);
  const failed = checks.filter(([, ok]) => !ok);
  const t = track();
  if (failed.length > 0) {
    return {
      ok: false,
      sends,
      toolCalls: [...t.toolCalls],
      costUsd: t.costUsd,
      reason: `${failed.length} check(s) failed after ${sends} send(s)`,
    };
  }
  return { ok: true, sends, toolCalls: [...t.toolCalls], costUsd: t.costUsd, reason: '' };
}

async function main(): Promise<void> {
  const apiKey = process.env['MODEL_API_KEY'];
  if (!apiKey) {
    console.log('FAIL: MODEL_API_KEY is not set');
    process.exitCode = 1;
    return;
  }

  // One gateway for both cases; the counters reset per case so each flow has
  // the same budget the single-flow eval had.
  let toolCalls: string[] = [];
  let costUsd = 0;
  const base = createGateway({
    client: new OpenAI({ apiKey, baseURL: 'https://api.meta.ai/v1' }),
  });
  const gateway: Gateway = {
    chatJson: async (o) => {
      const r = await base.chatJson(o);
      costUsd += r.costUsd;
      return r;
    },
    chatTools: async (o) => {
      const r = await base.chatTools(o);
      costUsd += r.costUsd;
      toolCalls.push(...r.toolCalls.map((c) => c.name));
      return r;
    },
  };

  let allOk = true;
  for (const c of CASES) {
    toolCalls = [];
    costUsd = 0;
    console.log(`--- ${c.name} ---`);
    const r = await runCase(c, gateway, () => ({ toolCalls, costUsd }));
    if (r.ok) {
      console.log(`PASS ${c.name} after ${r.sends} send(s)`);
    } else {
      allOk = false;
      console.log(`FAIL ${c.name}: ${r.reason}`);
    }
    console.log(`tool calls (${r.toolCalls.length}): ${r.toolCalls.join(', ') || '(none)'}`);
    console.log(`cost: $${r.costUsd.toFixed(4)}`);
  }
  console.log(allOk ? 'OVERALL: PASS' : 'OVERALL: FAIL');
  process.exitCode = allOk ? 0 : 1;
}

// No top-level await: the root package is CJS, so tsx compiles this as CJS.
void main();
