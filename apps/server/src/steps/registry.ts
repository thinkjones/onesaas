import type { Gateway } from '../models/gateway.js';
import type { TableStore } from '../tables/store.js';
import { extractExecutor, writeExecutor } from './ai.js';
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

export interface StepResult {
  output: unknown;
  why: string;
  model?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
}

// Trust boundary: config/input are trusted. Task 7 validates them against the
// catalog schemas before dispatch, so executors cast instead of re-validating.
export type Executor = (config: any, input: any, ctx: StepContext) => Promise<StepResult>;

export const executors: Record<string, Executor> = {
  'trigger.gmailButton': gmailButtonExecutor,
  'trigger.manual': manualExecutor,
  'ai.extract': extractExecutor,
  'ai.write': writeExecutor,
  'table.upsert': upsertExecutor,
  'gmail.read': readExecutor,
  'gmail.draftReply': draftReplyExecutor,
};
