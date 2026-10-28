import { z } from 'zod';

export const RunStatus = z.enum(['running', 'waiting', 'done', 'failed']);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepRunStatus = z.enum(['pending', 'running', 'waiting', 'done', 'failed', 'skipped']);
export type StepRunStatus = z.infer<typeof StepRunStatus>;

export const TokenUsage = z.object({ input: z.number(), output: z.number() });
export type TokenUsage = z.infer<typeof TokenUsage>;

export const Run = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowVersion: z.number(),
  triggerPayload: z.unknown(),
  status: RunStatus,
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

export const StepRun = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  status: StepRunStatus,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  model: z.string().optional(),
  tokens: TokenUsage.optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  why: z.string().optional(),
  startedAt: z.string(),
});
export type StepRun = z.infer<typeof StepRun>;
