import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Run, StepRun, Workflow } from '@dad/shared';

// Mirrors apps/server/src/engine/events.ts. The web package cannot import it
// (server is not a dependency), so the shape is redeclared here.
export type EngineEvent = { type: 'run'; run: Run } | { type: 'step'; stepRun: StepRun };

/** GET /api/runs/:id shape. `workflow` is the run's OWN pinned version. */
export interface RunDetail {
  run: Run;
  steps: StepRun[];
  story: string[];
  workflow: Workflow;
}

/** POST approval/retry responses OMIT `workflow` (it is immutable). */
export interface RunUpdate {
  run: Run;
  steps: StepRun[];
  story: string[];
}

/** Bodies must match the server's strict zod union EXACTLY — surplus keys 400. */
export type ApprovalAction =
  | { action: 'approve' }
  | { action: 'edit'; text: string }
  | { action: 'skip' };

/** Thrown by the API helpers; `status` lets callers (e.g. Task 6 toasts) branch on it. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Server failure bodies are `{ error: string }`; surface the message, not raw JSON.
async function throwApiError(res: Response): Promise<never> {
  const text = await res.text();
  let message = text;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
      message = (body as { error: string }).error;
    }
  } catch {
    // Non-JSON body: fall back to raw text.
  }
  throw new ApiError(message, res.status);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as T;
}

export function getWorkflows(): Promise<Workflow[]> {
  return getJson('/api/workflows');
}

export function getRuns(workflowId?: string): Promise<Run[]> {
  return getJson(
    workflowId ? `/api/runs?workflowId=${encodeURIComponent(workflowId)}` : '/api/runs',
  );
}

export function getRun(id: string): Promise<RunDetail> {
  return getJson(`/api/runs/${encodeURIComponent(id)}`);
}

export function approveStep(runId: string, stepId: string, body: ApprovalAction): Promise<RunUpdate> {
  return postJson(
    `/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/approval`,
    body,
  );
}

export function retryStep(runId: string, stepId: string): Promise<RunUpdate> {
  return postJson(
    `/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/retry`,
  );
}

export async function startPairing(): Promise<{ code: string }> {
  const res = await fetch('/api/pairing/start', { method: 'POST' });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as { code: string };
}

export function getPairingStatus(): Promise<{ paired: boolean; connected: boolean }> {
  return getJson('/api/pairing/status');
}

/** Subscribes to the SSE stream; closes the connection on unmount. */
export function useEvents(onEvent: (e: EngineEvent) => void): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    // No EventSource outside browsers (e.g. jsdom tests): skip, don't crash.
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onmessage = (msg: MessageEvent) => ref.current(JSON.parse(msg.data) as EngineEvent);
    return () => es.close();
  }, []);
}

// --- TanStack Query hooks (M2) ---

export function useWorkflows() {
  return useQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
}

// The server has no GET /api/workflows/:id, so this selects from the list.
export function useWorkflow(id: string) {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    select: (wfs) => wfs.find((w) => w.id === id),
  });
}

export function useRuns(workflowId: string) {
  return useQuery({ queryKey: ['runs', workflowId], queryFn: () => getRuns(workflowId) });
}

export function useRun(runId: string) {
  return useQuery({ queryKey: ['run', runId], queryFn: () => getRun(runId) });
}

// Merges a POST response into the cached detail, keeping the existing pinned
// `workflow` (POSTs omit it). Falls back to a re-GET when nothing is cached.
function mergeRunUpdate(client: QueryClient, runId: string, update: RunUpdate): void {
  const cached = client.getQueryData<RunDetail>(['run', runId]);
  if (cached) {
    client.setQueryData<RunDetail>(['run', runId], { ...update, workflow: cached.workflow });
  } else {
    void client.invalidateQueries({ queryKey: ['run', runId] });
  }
  void client.invalidateQueries({ queryKey: ['runs', update.run.workflowId] });
}

export function useApprove(runId: string, stepId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ApprovalAction) => approveStep(runId, stepId, body),
    onSuccess: (update) => mergeRunUpdate(client, runId, update),
  });
}

export function useRetry(runId: string, stepId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => retryStep(runId, stepId),
    onSuccess: (update) => mergeRunUpdate(client, runId, update),
  });
}

// NOTE: run.endedAt is only meaningful on terminal runs — a failed→waiting
// retry leaves a stale endedAt behind (known server wart). Never display
// durations off endedAt for non-terminal runs.

/** Subscribes to /api/events once and invalidates run queries per event. */
export function useLiveEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onmessage = (msg: MessageEvent) => {
      const e = JSON.parse(msg.data) as EngineEvent;
      if (e.type === 'run') {
        void client.invalidateQueries({ queryKey: ['run', e.run.id] });
        void client.invalidateQueries({ queryKey: ['runs', e.run.workflowId] });
      } else {
        // Step events carry no workflowId, so the runs lists are invalidated
        // by prefix instead of per workflow.
        void client.invalidateQueries({ queryKey: ['run', e.stepRun.runId] });
        void client.invalidateQueries({ queryKey: ['runs'] });
      }
    };
    return () => es.close();
  }, [client]);
}
