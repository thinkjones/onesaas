import type { EventEmitter } from 'node:events';
import type { TestRunResult } from '../engine/testRun.js';
import type { Gateway, AgentMessage } from '../models/gateway.js';
import type { Repo } from '../db/repo.js';
import type { TableStore } from '../tables/store.js';
import type { WorkflowOps } from '../workflows/ops.js';
import { checkWorkflow } from '../workflows/validate.js';
import type { Conversation, ConversationStore, TranscriptEntry } from './conversations.js';
import { TANGLED_MESSAGE, TOOL_CALL_CAP, buildSystemPrompt } from './prompt.js';
import { builderTools, type AgentEvent, type Engine, type ToolContext } from './tools.js';

/** Rejection message when a second send arrives while a turn is running. */
export const AGENT_BUSY_MESSAGE = 'Still thinking about your last message.';

export class AgentBusyError extends Error {
  constructor() {
    super(AGENT_BUSY_MESSAGE);
    this.name = 'AgentBusyError';
  }
}

export interface BuilderAgentDeps {
  gateway: Gateway;
  ops: WorkflowOps;
  tables: TableStore;
  repo: Repo;
  engine: Engine;
  events: EventEmitter;
  conversations: ConversationStore;
  /** Bound by the composition root (it owns the executors/bridge). */
  testRun: (workflowId: string) => Promise<TestRunResult>;
}

export interface BuilderAgent {
  /** One turn: runs to completion (done) unless the workflow is busy. */
  send(workflowId: string, text: string): Promise<void>;
  /** Record one of Dad's canvas edits for the next model call. Never busy. */
  noteManualChange(workflowId: string, note: string): void;
  getTranscript(workflowId: string): TranscriptEntry[];
  isBusy(workflowId: string): boolean;
}

/** There is no stored business profile yet (M5): server-local, like the engine. */
function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function createBuilderAgent(d: BuilderAgentDeps): BuilderAgent {
  const { gateway, ops, tables, repo, engine, events, conversations, testRun } = d;
  const toolsByName = new Map(builderTools.map((t) => [t.name, t]));
  const busy = new Set<string>();
  // Live turns by workflow: noteManualChange appends to the in-flight
  // conversation (not the stale persisted one) so a Dad edit mid-turn is
  // neither lost at persist time nor invisible to the next model call.
  const active = new Map<string, Conversation>();

  async function send(workflowId: string, text: string): Promise<void> {
    // No await before the add: the flag is set synchronously at call time,
    // so a concurrent second send always sees it.
    if (busy.has(workflowId)) throw new AgentBusyError();
    busy.add(workflowId);
    try {
      await runTurn(workflowId, text);
    } finally {
      busy.delete(workflowId);
      active.delete(workflowId);
    }
  }

  function noteManualChange(workflowId: string, note: string): void {
    const msg: AgentMessage = { role: 'system', content: `Dad changed the canvas: ${note}` };
    const live = active.get(workflowId);
    if (live) {
      live.messages.push(msg);
      conversations.save(workflowId, live);
      return;
    }
    const conv = conversations.load(workflowId) ?? { messages: [], transcript: [] };
    conv.messages.push(msg);
    conversations.save(workflowId, conv);
  }

  function getTranscript(workflowId: string): TranscriptEntry[] {
    return conversations.load(workflowId)?.transcript ?? [];
  }

  function isBusy(workflowId: string): boolean {
    return busy.has(workflowId);
  }

  async function runTurn(workflowId: string, text: string): Promise<void> {
    const start = repo.getWorkflow(workflowId);
    if (!start) throw new Error(`Unknown workflow: ${workflowId}`);
    const conv = conversations.load(workflowId) ?? { messages: [], transcript: [] };
    active.set(workflowId, conv);
    conv.messages.push({ role: 'user', content: text });
    conv.transcript.push({ role: 'dad', text, at: Date.now() });

    const emit = (e: AgentEvent): void => {
      if (e.type === 'say') {
        conv.transcript.push({ role: 'agent', text: e.text, at: Date.now() });
      } else if (e.type === 'ask') {
        conv.transcript.push({
          role: 'agent',
          text: e.question,
          ask: { question: e.question, options: e.options },
          at: Date.now(),
        });
      }
      // A listener must never break a turn (engine precedent: emit is guarded).
      try {
        events.emit('event', { type: 'agent', workflowId, event: e });
      } catch {
        // Deliberately swallowed: listener errors are not turn errors.
      }
    };

    const ctx: ToolContext = {
      workflowId,
      ops,
      tables,
      repo,
      engine,
      gateway,
      testRun,
      emit,
    };

    const finish = (): void => {
      conversations.save(workflowId, conv);
      emit({ type: 'done' });
    };

    let calls = 0;
    try {
      for (;;) {
        // Rebuilt from the LATEST workflow every iteration: Dad may edit mid-turn.
        const wf = repo.getWorkflow(workflowId);
        if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
        const system = buildSystemPrompt({
          business: { timezone: serverTimezone() },
          workflow: wf,
          problems: checkWorkflow(wf, tables),
          tables: tables.listTables(),
        });
        const res = await gateway.chatTools({
          role: 'builder',
          messages: [{ role: 'system', content: system }, ...conv.messages],
          tools: builderTools,
        });
        const assistant: AgentMessage = {
          role: 'assistant',
          content: res.message.content ?? null,
          ...(res.message.tool_calls && res.message.tool_calls.length > 0
            ? { tool_calls: res.message.tool_calls }
            : {}),
        };
        conv.messages.push(assistant);
        if (typeof res.message.content === 'string' && res.message.content.length > 0) {
          emit({ type: 'say', text: res.message.content });
        }
        if (res.toolCalls.length === 0) {
          finish();
          return;
        }
        let endTurn = false;
        for (let n = 0; n < res.toolCalls.length; n += 1) {
          const call = res.toolCalls[n]!;
          calls += 1;
          if (calls > TOOL_CALL_CAP) {
            // The 21st call is NOT executed. This call and the rest of the
            // response still get tool results — the API rejects an assistant
            // message whose tool_calls lack matching results on the next call.
            for (const skipped of res.toolCalls.slice(n)) {
              conv.messages.push({
                role: 'tool',
                tool_call_id: skipped.id,
                content: `Problem: not run — the turn used all ${TOOL_CALL_CAP} tool calls.`,
              });
            }
            conv.messages.push({ role: 'assistant', content: TANGLED_MESSAGE });
            emit({ type: 'say', text: TANGLED_MESSAGE });
            finish();
            return;
          }
          const tool = toolsByName.get(call.name);
          if (!tool) {
            conv.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `Problem: there is no tool called ${call.name}.`,
            });
            continue;
          }
          if (call.argsError !== undefined) {
            conv.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `Problem: ${call.argsError}`,
            });
            continue;
          }
          const out = await tool.run(call.args, ctx);
          conv.messages.push({ role: 'tool', tool_call_id: call.id, content: out.result });
          if (out.endTurn) endTurn = true;
        }
        // EndTurn tools stop the turn: the rest of THIS response still ran (so
        // every tool_call has its result), but the model is not called again.
        if (endTurn) {
          finish();
          return;
        }
      }
    } catch (err) {
      // Failure path (gateway/DB/prompt threw): the turn still ends cleanly.
      // Dad sees a failure line, the conversation-so-far is kept, and `done`
      // preserves the done-means-turn-over contract. send() still rejects below
      // so direct callers see the error.
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'say', text: `Something went wrong: ${msg}` });
      try {
        conversations.save(workflowId, conv);
      } catch {
        // Best effort: even with a dead store, the terminal event still fires.
      }
      emit({ type: 'done' });
      throw err;
    }
  }

  return { send, noteManualChange, getTranscript, isBusy };
}
