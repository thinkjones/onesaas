import type { Gateway } from '../models/gateway.js';
import type { TableStore } from '../tables/store.js';
import { extractExecutor, writeExecutor } from './ai.js';
import { askExecutor } from './approval.js';
import { createEventExecutor, freeBusyExecutor } from './calendar.js';
import { classifyExecutor } from './classify.js';
import { insertExecutor, queryExecutor, upsertExecutor } from './table.js';
import {
  draftReplyExecutor,
  emailExecutor,
  gmailButtonExecutor,
  manualExecutor,
  readExecutor,
  uploadExecutor,
} from './trigger.js';

// Structural stand-in for the Task 8 bridge: the call shape executors need
// (M4 adds the tab option: reads run in worker tabs, visible acts in the
// active tab). The real bridge satisfies this interface structurally.
export interface Bridge {
  call(
    site: 'gmail' | 'calendar' | 'meta',
    action: string,
    input: unknown,
    timeoutMs?: number,
    opts?: { tab?: 'worker' | 'active' },
  ): Promise<unknown>;
}

export interface StepContext {
  gateway: Gateway;
  tables: TableStore;
  bridge: Bridge;
  signal: AbortSignal;
  // True inside test runs ("Try it"): outside-world actions become previews.
  // Optional so existing live callers keep working; undefined means live.
  testMode?: boolean;
  // Injectable clock + business timezone for date-aware AI steps. The
  // composition root supplies both (timezone from settings, falling back to
  // the server's Intl zone); tests fix them for deterministic prompts.
  // Optional so older callers keep working: missing means "right now" in
  // the server's own timezone.
  now?: () => Date;
  timezone?: string;
}

/** Wall-clock time for this run: the injected clock, else right now. */
export function ctxNow(ctx: StepContext): Date {
  return ctx.now?.() ?? new Date();
}

/** IANA business timezone for this run: settings, else the server zone. */
export function ctxTimezone(ctx: StepContext): string {
  return ctx.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface ApprovalWait {
  kind: 'approval';
  question: string;
  proposed: unknown;
}

export interface StepResult {
  output: unknown;
  why: string;
  model?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
  // When present, the engine parks the step as `waiting` instead of `done`
  // (output validation is skipped: the output is provisional, not final).
  wait?: ApprovalWait;
}

// Trust boundary: the engine validates config/input/output against the catalog
// schemas before each executor runs. Executors cast instead of re-validating.
//
// An executor is `run` (the callable itself) plus an optional `preview`: in
// testMode the engine calls `preview` when present, otherwise `run`. Only
// act/store executors (and approval.ask) define one — everything else runs
// for real in tests.
export type Executor = {
  (config: any, input: any, ctx: StepContext): Promise<StepResult>;
  preview?: (config: any, input: any, ctx: StepContext) => Promise<StepResult>;
};

export const executors: Record<string, Executor> = {
  'trigger.gmailButton': gmailButtonExecutor,
  'trigger.manual': manualExecutor,
  'trigger.email': emailExecutor,
  'trigger.upload': uploadExecutor,
  'ai.extract': extractExecutor,
  'ai.write': writeExecutor,
  'ai.classify': classifyExecutor,
  'table.upsert': upsertExecutor,
  'table.insert': insertExecutor,
  'table.query': queryExecutor,
  'gmail.read': readExecutor,
  'gmail.draftReply': draftReplyExecutor,
  'calendar.freeBusy': freeBusyExecutor,
  'calendar.createEvent': createEventExecutor,
  'approval.ask': askExecutor,
};
