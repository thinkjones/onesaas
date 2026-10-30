// Builder eval (M3 Task 5, NOT a test gate): drives the real builder agent
// against the live model once and checks it builds the customer-email flow.
// Run from the repo root: pnpm tsx scripts/eval-builder.ts
// Needs MODEL_API_KEY in the environment. Uses a :memory: DB — never the
// live app.db. Exit code is 0 on PASS, 1 on FAIL. Prints PASS/FAIL plus the
// tool calls made and the total model cost.
import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
// Relative, not '@dad/shared': the workspace link only exists under
// apps/server/node_modules, so the bare specifier fails from scripts/ at both
// typecheck and tsx runtime. (Shared's own main IS this src entry.)
import { catalog } from '../packages/shared/src/index.js';
import { createConversationStore } from '../apps/server/src/agent/conversations.js';
import { createBuilderAgent } from '../apps/server/src/agent/loop.js';
import type { AgentEvent } from '../apps/server/src/agent/tools.js';
import { openDb } from '../apps/server/src/db/connection.js';
import { createRepo } from '../apps/server/src/db/repo.js';
import { createEngine } from '../apps/server/src/engine/engine.js';
import { createTestRunner } from '../apps/server/src/engine/testRun.js';
import { createGateway, type Gateway } from '../apps/server/src/models/gateway.js';
import { executors, type Bridge } from '../apps/server/src/steps/registry.js';
import { createTableStore } from '../apps/server/src/tables/store.js';
import { checkWorkflow } from '../apps/server/src/workflows/validate.js';
import { createWorkflowOps } from '../apps/server/src/workflows/ops.js';

const FIRST_SEND =
  'When a customer emails me, save them in my customer list and draft a friendly reply for me to check.';
const MAX_SENDS = 10;
const COST_CAP_USD = 2;

const REQUIRED_STEPS = ['ai.extract', 'table.upsert', 'ai.write', 'approval.ask', 'gmail.draftReply'];

function fail(reason: string, extra: { toolCalls: string[]; costUsd: number }): never {
  console.log(`FAIL: ${reason}`);
  console.log(`tool calls (${extra.toolCalls.length}): ${extra.toolCalls.join(', ') || '(none)'}`);
  console.log(`cost: $${extra.costUsd.toFixed(4)}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const apiKey = process.env['MODEL_API_KEY'];
  if (!apiKey) {
    console.log('FAIL: MODEL_API_KEY is not set');
    process.exitCode = 1;
    return;
  }

  const db = openDb(':memory:');
  const tables = createTableStore(db);
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
  const repo = createRepo(db);
  const conversations = createConversationStore(db);
  const agentEvents = new EventEmitter();

  const toolCalls: string[] = [];
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
  const track = (): { toolCalls: string[]; costUsd: number } => ({ toolCalls, costUsd });

  let pending: string | null = FIRST_SEND;
  let sends = 0;
  try {
    while (pending !== null) {
      sends += 1;
      if (sends > MAX_SENDS) fail(`still going after ${MAX_SENDS} sends`, track());
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
      if (costUsd > COST_CAP_USD) fail(`over the $${COST_CAP_USD} cost cap`, track());
      pending = null;
      for (const e of turnEvents) {
        if (e.type === 'ask') pending = e.options[0] ?? null;
        if (e.type === 'plan') pending = 'Yes, build it';
      }
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), track());
  }

  const built = repo.getWorkflow(wf.id)!;
  const problems = checkWorkflow(built, tables);
  const stepTypes = built.steps.map((s) => s.type);
  const checks: [string, boolean][] = [
    [
      `trigger is ${built.trigger.type} (want trigger.gmailButton or trigger.email)`,
      built.trigger.type === 'trigger.gmailButton' || built.trigger.type === 'trigger.email',
    ],
    ...REQUIRED_STEPS.map(
      (t): [string, boolean] => [`step ${t} present`, stepTypes.includes(t)],
    ),
    [
      problems.length === 0
        ? 'checkWorkflow empty'
        : `checkWorkflow: ${problems.map((p) => `${p.stepId}: ${p.problem}`).join('; ')}`,
      problems.length === 0,
    ],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'MISSING'}: ${label}`);
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) fail(`${failed.length} check(s) failed after ${sends} send(s)`, track());

  console.log(`PASS after ${sends} send(s)`);
  console.log(`tool calls (${toolCalls.length}): ${toolCalls.join(', ')}`);
  console.log(`cost: $${costUsd.toFixed(4)}`);
}

// No top-level await: the root package is CJS, so tsx compiles this as CJS.
void main();
