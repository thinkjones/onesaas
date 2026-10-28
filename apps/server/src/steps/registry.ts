import type { Gateway } from '../models/gateway.js';
import type { TableStore } from '../tables/store.js';
import { extractExecutor, writeExecutor } from './ai.js';
import { askExecutor } from './approval.js';
import { upsertExecutor } from './table.js';
import {
  draftReplyExecutor,
  gmailButtonExecutor,
  manualExecutor,
  readExecutor,
} from './trigger.js';

// Structural stand-in for the Task 8 bridge: only the call shape Task 6
// needs. The real bridge satisfies this interface structurally.
export interface Bridge {
  call(
    site: 'gmail' | 'calendar' | 'meta',
    action: string,
    input: unknown,
    timeoutMs?: number,
  ): Promise<unknown>;
}

export interface StepContext {
  gateway: Gateway;
  tables: TableStore;
  bridge: Bridge;
  signal: AbortSignal;
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
export type Executor = (config: any, input: any, ctx: StepContext) => Promise<StepResult>;

export const executors: Record<string, Executor> = {
  'trigger.gmailButton': gmailButtonExecutor,
  'trigger.manual': manualExecutor,
  'ai.extract': extractExecutor,
  'ai.write': writeExecutor,
  'table.upsert': upsertExecutor,
  'gmail.read': readExecutor,
  'gmail.draftReply': draftReplyExecutor,
  'approval.ask': askExecutor,
};
