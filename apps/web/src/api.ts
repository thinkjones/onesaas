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

/** Thrown by the API helpers; the cards toast `message` on mutation failure (`status` carried for branching). */
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

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export async function revokePairing(): Promise<{ revoked: boolean }> {
  const res = await fetch('/api/pairing/revoke', { method: 'POST' });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as { revoked: boolean };
}

/** GET /api/settings: the stored business timezone, or null when unset. */
export function getSettings(): Promise<{ timezone: string | null }> {
  return getJson('/api/settings');
}

/** PUT /api/settings: store the business timezone (IANA name). */
export function putSettings(timezone: string): Promise<{ timezone: string }> {
  return putJson('/api/settings', { timezone });
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

export function useRun(runId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => getRun(runId),
    enabled: opts?.enabled ?? true,
  });
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

// --- Design mode (M3) ---

/** Mirrors apps/server/src/workflows/validate.ts WorkflowProblem (same reason as EngineEvent). */
export interface WorkflowProblem {
  stepId: string;
  problem: string;
}

/** GET /api/workflows/:id: the latest version plus its plain-English problems. */
export interface WorkflowDetail extends Workflow {
  problems: WorkflowProblem[];
}

export function getWorkflowDetail(id: string): Promise<WorkflowDetail> {
  return getJson(`/api/workflows/${encodeURIComponent(id)}`);
}

export function useWorkflowDetail(id: string) {
  return useQuery({ queryKey: ['workflow', id], queryFn: () => getWorkflowDetail(id) });
}

/** Every ops-route op except `create` (which has its own route). */
export type WorkflowOpName =
  | 'setTrigger'
  | 'addStep'
  | 'updateStep'
  | 'removeStep'
  | 'connect'
  | 'disconnect'
  | 'move'
  | 'setStatus'
  | 'rename';

/** A refused op is still a 200: the body carries the readable error. */
export type OpResult =
  | { ok: true; workflow: Workflow; note: string }
  | { ok: false; error: string };

/** POST /api/workflows/:id/ops. Args are POSITIONAL — the id comes from the URL. */
export function postOp(workflowId: string, op: WorkflowOpName, args: unknown[]): Promise<OpResult> {
  return postJson(`/api/workflows/${encodeURIComponent(workflowId)}/ops`, { op, args });
}

export function useWorkflowOp(workflowId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (call: { op: WorkflowOpName; args: unknown[] }) =>
      postOp(workflowId, call.op, call.args),
    onSuccess: (res) => {
      // Refused ops carry no new state; the call site toasts res.error.
      if (!res.ok) return;
      // Instant canvas paint from the returned workflow, keeping the old
      // problems until the refetch below replaces them (ops don't return
      // problems, so setting them directly would freeze stale badges).
      client.setQueryData<WorkflowDetail>(['workflow', workflowId], (old) =>
        old ? { ...res.workflow, problems: old.problems } : old,
      );
      void client.invalidateQueries({ queryKey: ['workflow', workflowId] });
      void client.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

/** POST /api/workflows/:id/test: the test run plus story lines for the strip. */
export interface TestRunResponse {
  run: Run;
  steps: StepRun[];
  usedSample: boolean;
  story: string[];
}

export function postTestRun(workflowId: string): Promise<TestRunResponse> {
  return postJson(`/api/workflows/${encodeURIComponent(workflowId)}/test`);
}

export function useTestRun(workflowId: string) {
  return useMutation({ mutationFn: () => postTestRun(workflowId) });
}

/**
 * Mirrors apps/server/src/agent/tools.ts AgentEvent (the web package cannot
 * import server code, so the shape is redeclared here like EngineEvent).
 */
export type AgentEvent =
  | { type: 'say'; text: string }
  | { type: 'ask'; question: string; options: string[] }
  | {
      type: 'plan';
      ghosts: { id: string; type: string; title: string; summary: string }[];
      edges: { from: string; to: string; when?: string }[];
    }
  | { type: 'activity'; text: string }
  | { type: 'built'; stepId: string }
  | { type: 'test'; runId: string }
  | { type: 'done' };

/**
 * How long DesignView waits for a `built` step to land in the refetched
 * workflow before surfacing "couldn't load" (a silently-hung fetch must not
 * strand its ghost forever). Exported for the fake-timer test; lives here
 * (not DesignView) so the component file exports components only.
 */
export const PENDING_BUILT_TIMEOUT_MS = 20_000;

/** POST /api/workflows {name, description}: a blank reducer (steps come later). */
export function createWorkflow(body: { name: string; description: string }): Promise<Workflow> {
  return postJson('/api/workflows', body);
}

export function useCreateWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description: string }) => createWorkflow(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

/**
 * Mirrors apps/server/src/agent/conversations.ts TranscriptEntry (the web
 * package cannot import server code, so the shape is redeclared here like
 * EngineEvent). One visible row: Dad's sends plus the agent's `say` and `ask`
 * (activity/plan/built/test are live-only and never persist).
 */
export interface AgentTranscriptEntry {
  role: 'dad' | 'agent';
  text: string;
  ask?: { question: string; options: string[] };
  at: number;
}

/** GET /api/workflows/:id/agent: the persisted visible transcript. */
export function getAgentTranscript(workflowId: string): Promise<AgentTranscriptEntry[]> {
  return getJson(`/api/workflows/${encodeURIComponent(workflowId)}/agent`);
}

/**
 * POST /api/workflows/:id/agent {text}: one turn (202, runs in the
 * background). A second send while the turn runs is a 409 carrying the
 * server's plain-words busy message — callers surface it, never crash.
 */
export function sendAgentMessage(workflowId: string, text: string): Promise<void> {
  return postJson(`/api/workflows/${encodeURIComponent(workflowId)}/agent`, { text });
}

/**
 * Subscribes to one workflow's agent events over SSE. A dedicated EventSource
 * (useLiveEvents ignores agent events): cheap enough for one design screen,
 * skipped outside browsers like useEvents.
 */
export function useAgentEvents(workflowId: string, onEvent: (e: AgentEvent) => void): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onmessage = (msg: MessageEvent) => {
      const data = JSON.parse(msg.data) as {
        type?: unknown;
        workflowId?: unknown;
        event?: AgentEvent;
      };
      if (data.type === 'agent' && data.workflowId === workflowId && data.event) {
        ref.current(data.event);
      }
    };
    return () => es.close();
  }, [workflowId]);
}

// NOTE: run.endedAt is only meaningful on terminal runs — a failed→waiting
// retry leaves a stale endedAt behind (known server wart). Never display
// durations off endedAt for non-terminal runs.

/** Reconnect backoffs after an EventSource error; the last delay repeats. */
const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

/**
 * First-load timezone sync: GETs the stored business timezone and, when none
 * is stored, PUTs the browser's zone. Runs once per mount; a double-mount
 * races two idempotent PUTs of the same value, which is harmless. Failures
 * are swallowed: the server falls back to its own zone, so a failed sync
 * must never break the app.
 */
export function useTimezoneSync(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { timezone } = await getSettings();
        if (cancelled || timezone) return;
        await putSettings(Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        // Best-effort only (see above).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * Subscribes to /api/events once and invalidates run queries per event.
 * Reconnects on error with 1/2/5s backoff (native retry is suppressed via
 * close() so only one connection exists) and on reconnect invalidates every
 * ['run', *] query by prefix so the open run is never stale. Double-mount
 * safe: cleanup closes the connection and clears the pending timer.
 */
export function useLiveEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let es: EventSource | undefined;
    const onMessage = (msg: MessageEvent) => {
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
    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.onmessage = onMessage;
      es.onerror = () => {
        es?.close();
        if (closed) return;
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
      es.onopen = () => {
        // Only a post-error open is a reconnect; the initial open refetches
        // nothing (mount queries are already fresh).
        if (attempt > 0) {
          attempt = 0;
          void client.invalidateQueries({ queryKey: ['run'] });
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      es?.close();
    };
  }, [client]);
}
