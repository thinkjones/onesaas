import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { FileRef, Run, StepRun, Workflow } from '@onesaas/shared';
import type { ListSummary, ViewData, ViewDef } from './lists/types.ts';

// Mirrors apps/server/src/engine/events.ts. The web package cannot import it
// (server is not a dependency), so the shape is redeclared here.
export type EngineEvent =
  | { type: 'run'; run: Run }
  | { type: 'step'; stepRun: StepRun }
  | { type: 'notify'; text: string }
  // M5 Task 4: a background mood-image run finished — the stored set changed.
  | { type: 'mood'; fileIds: string[] };

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

/** True inside the Tauri desktop shell (Bug #6), false in browsers and tests. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Prefixes relative API paths for the desktop shell. Browsers use vite's
 * /api proxy (relative URLs); the packaged app has no proxy, so it talks
 * to the bundled sidecar on loopback directly.
 */
export function apiUrl(path: string): string {
  return isTauri() ? `http://127.0.0.1:8787${path}` : path;
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
  const res = await fetch(apiUrl(url));
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(url), {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as T;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(url), {
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

/** POST /api/workflows/:id/upload: saves the photo and starts a run with it. */
export interface UploadResult {
  run: Run;
  file: FileRef;
}

export async function uploadPhoto(
  workflowId: string,
  file: File,
  note?: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.set('file', file);
  if (note !== undefined) form.set('note', note);
  const res = await fetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}/upload`), {
    method: 'POST',
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as UploadResult;
}

export async function startPairing(): Promise<{ code: string }> {
  const res = await fetch(apiUrl('/api/pairing/start'), { method: 'POST' });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as { code: string };
}

/** GET /api/pairing/status: Task 11 { paired, connected } plus the last-contact record. */
export interface PairingStatus {
  paired: boolean;
  connected: boolean;
  lastPingAt: string | null;
  peer: string | null;
  /** Monotonic redeem count (0 unpaired): the code screen completes when this moves. */
  generation: number;
}

export function getPairingStatus(): Promise<PairingStatus> {
  return getJson('/api/pairing/status');
}

/** GET /api/debug/events: the bridge's recent in-memory event log (debug mode). */
export interface DebugEvent {
  t: string;
  msg: string;
}

export function getDebugEvents(): Promise<{ events: DebugEvent[] }> {
  return getJson('/api/debug/events');
}

/** POST /api/pairing/ping: round-trips a live probe, reporting the (possibly self-healed) state. */
export interface PairingPing {
  ok: boolean;
  connected: boolean;
  lastPingAt: string | null;
  peer: string | null;
}

export async function pingPairing(): Promise<PairingPing> {
  const res = await fetch(apiUrl('/api/pairing/ping'), { method: 'POST' });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as PairingPing;
}

export async function revokePairing(): Promise<{ revoked: boolean }> {
  const res = await fetch(apiUrl('/api/pairing/revoke'), { method: 'POST' });
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as { revoked: boolean };
}

/**
 * Mirrors apps/server/src/settings/store.ts Settings (the web package cannot
 * import server code, so the shape is redeclared here like EngineEvent).
 */
export interface Settings {
  businessName?: string;
  businessWhat?: string;
  /** IANA zone; '' until the first-load sync stores the browser zone. */
  timezone: string;
  textSize: 'normal' | 'large' | 'xlarge';
  onboarded: boolean;
  moodFileIds: string[];
  vertical: string | null;
  interests: number[];
  interestsNote: string;
}

/** PUT /api/settings takes a partial patch. */
export type SettingsPatch = Partial<Settings>;

/** GET /api/settings: the full settings document. */
export function getSettings(): Promise<Settings> {
  return getJson('/api/settings');
}

/**
 * POST /api/mood/generate: draw the business in the background (202, the set
 * lands via the `mood` event). Best-effort by design — a failure leaves the
 * bundled defaults in place and must never block onboarding.
 */
export async function requestMoodGeneration(): Promise<void> {
  try {
    await postJson('/api/mood/generate');
  } catch {
    console.debug('[mood] background generation request failed');
  }
}

/** PUT /api/settings: merge a patch into the settings document. */
export function putSettings(patch: SettingsPatch): Promise<Settings> {
  return putJson('/api/settings', patch);
}

/** The saved OpenAI-compatible endpoint. The server never returns the key. */
export interface ModelConnection {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** A key in MODEL_API_KEY. GET only. */
  hasEnvKey?: boolean;
}

export function getModelConnection(): Promise<ModelConnection> {
  return getJson('/api/models/connection');
}

/** An omitted field stays as it is; an empty string clears it. */
export function putModelConnection(patch: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<ModelConnection> {
  return putJson('/api/models/connection', patch);
}

/** POST /api/data/reset: wipe the store back to fresh-install state. */
export function postDataReset(): Promise<{ ok: boolean }> {
  return postJson('/api/data/reset');
}

/**
 * The Settings Reset-data button: after the wipe every cached query is stale
 * (workflows, lists, views, settings…), so all of them are invalidated and the
 * caller navigates to /welcome. A failure toasts and navigates nowhere.
 */
export function useDataReset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: postDataReset,
    onSuccess: () => {
      void client.invalidateQueries();
    },
    onError: () => {
      toast('Could not reset the data.');
    },
  });
}

/**
 * The settings document plus an optimistic `update(patch)`: the UI (text
 * size) applies instantly and rolls back with a toast if the PUT fails.
 * `updateAsync` is the same mutation awaitable (onboarding awaits it so the
 * save lands before the mood POST reads the profile). Shares the ['settings']
 * query with useBusinessTimezone below.
 */
export function useSettings(): {
  settings: Settings | undefined;
  update: (patch: SettingsPatch) => void;
  updateAsync: (patch: SettingsPatch) => Promise<Settings>;
} {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const mutation = useMutation({
    mutationFn: (patch: SettingsPatch) => putSettings(patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: ['settings'] });
      const previous = client.getQueryData<Settings>(['settings']);
      if (previous) {
        client.setQueryData<Settings>(['settings'], {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) client.setQueryData(['settings'], context.previous);
      toast('Could not save that change.');
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  return {
    settings: query.data,
    update: (patch) => mutation.mutate(patch),
    updateAsync: (patch) => mutation.mutateAsync(patch),
  };
}

// --- Lists + views (M4 Task 8) ---

/** GET /api/lists: every table plus its row count. */
export function getLists(): Promise<ListSummary[]> {
  return getJson('/api/lists');
}

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: getLists });
}

/** GET /api/lists/:table/rows: one page of rows plus the total. */
export function getListRows(
  table: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  return getJson(`/api/lists/${encodeURIComponent(table)}/rows${qs}`);
}

export function useListRows(table: string | null, opts?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['list-rows', table, opts?.limit, opts?.offset],
    queryFn: () => getListRows(table!, opts),
    enabled: table !== null,
  });
}

/** GET /api/views: every saved view. */
export function getViews(): Promise<ViewDef[]> {
  return getJson('/api/views');
}

export function useViews() {
  return useQuery({ queryKey: ['views'], queryFn: getViews });
}

/** GET /api/views/:id/data: a view's computed rows or value. */
export function getViewData(id: string): Promise<ViewData> {
  return getJson(`/api/views/${encodeURIComponent(id)}/data`);
}

export function useViewData(id: string) {
  return useQuery({ queryKey: ['view-data', id], queryFn: () => getViewData(id) });
}

/** POST /api/views: save a view (every pin is a save with pinned: true). */
export function createView(body: Omit<ViewDef, 'id'>): Promise<ViewDef> {
  return postJson('/api/views', body);
}

export function useCreateView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<ViewDef, 'id'>) => createView(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['views'] });
    },
  });
}

export function useDeleteView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(apiUrl(`/api/views/${encodeURIComponent(id)}`), { method: 'DELETE' });
      if (!res.ok) await throwApiError(res);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['views'] });
    },
  });
}

export function useBusinessTimezone() {
  return useQuery({ queryKey: ['settings'], queryFn: getSettings });
}

/**
 * Mirrors apps/server/src/models/gateway.ts ModelStatus (the web package
 * cannot import server code, so the shape is redeclared here like
 * EngineEvent). One row per model role: where it runs and whether it is up.
 */
export type ModelRole = 'builder' | 'planner' | 'triage' | 'vision';

export interface ModelStatus {
  role: ModelRole;
  provider: 'meta' | 'glimmer' | 'custom';
  model: string;
  healthy: boolean;
  note?: string;
}

export type ModelKeyStatus = 'ok' | 'missing' | 'rejected' | 'unknown';

/** POST /api/extension/install: where the Chrome extension is ready to load from. */
export function installExtension(): Promise<{ path: string }> {
  return postJson('/api/extension/install', {});
}

/** GET /api/models/check: can the current key sign in to the AI model? */
export function getModelKeyCheck(): Promise<{ status: ModelKeyStatus }> {
  return getJson('/api/models/check');
}

/** GET /api/models/status: the per-role rows for Settings → Thinking. */
export function getModelStatus(): Promise<ModelStatus[]> {
  return getJson('/api/models/status');
}

export function useModelStatus() {
  // The server re-checks Glimmer every 60 s; poll on the same cadence so
  // Settings picks up a revive (or outage) without a reload.
  return useQuery({ queryKey: ['model-status'], queryFn: getModelStatus, refetchInterval: 60_000 });
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
    const es = new EventSource(apiUrl('/api/events'));
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
  | { type: 'switched'; workflowId: string }
  | { type: 'done' };

/**
 * How long DesignView waits for a `built` step to land in the refetched
 * workflow before surfacing "couldn't load" (a silently-hung fetch must not
 * strand its ghost forever). Exported for the fake-timer test; lives here
 * (not DesignView) so the component file exports components only.
 */
export const PENDING_BUILT_TIMEOUT_MS = 20_000;

/**
 * How long the onboarding reframe screen waits for the generated mood set
 * before settling on the bundled defaults. The swap still happens if the set
 * lands later — the timeout only ends the "Drawing your business…" shimmer.
 * This is real behavior (a live setTimeout), not a test artifact.
 */
export const MOOD_DRAW_TIMEOUT_MS = 20_000;

/** POST /api/workflows {name, description}: a blank automation (steps come later). */
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

export function useDeleteWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ deleted: boolean }> => {
      const res = await fetch(apiUrl(`/api/workflows/${encodeURIComponent(id)}`), {
        method: 'DELETE',
      });
      if (!res.ok) await throwApiError(res);
      return (await res.json()) as { deleted: boolean };
    },
    onSuccess: (_res, id) => {
      void client.invalidateQueries({ queryKey: ['workflows'] });
      void client.invalidateQueries({ queryKey: ['workflow', id] });
      void client.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

/**
 * Mirrors apps/server/src/agent/conversations.ts TranscriptEntry (the web
 * package cannot import server code, so the shape is redeclared here like
 * EngineEvent). One visible row: the owner's sends plus the agent's `say` and `ask`
 * (activity/plan/built/test are live-only and never persist).
 */
export interface AgentTranscriptEntry {
  role: 'owner' | 'agent';
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
 * Mirrors the server's ExplainBody (apps/server/src/explain/explain.ts).
 * `context` scopes the id: the workflow id for a step, the table for a
 * column. Runs, tables and UI controls need no context.
 */
export interface ExplainTarget {
  kind: 'step' | 'run' | 'table' | 'column' | 'ui';
  id?: string;
  context?: string;
}

/** POST /api/explain: a 2–3 sentence plain-English explanation. */
export function postExplain(target: ExplainTarget): Promise<{ text: string }> {
  return postJson('/api/explain', target);
}

/** SSE event asking desktop webviews to focus + navigate (mirrors server app.ts). */
export interface AppFocusEvent {
  type: 'app-focus';
  path: string;
  hash?: string;
}

const focusListeners = new Set<(e: AppFocusEvent) => void>();

/** Subscribe to desktop-focus events; returns an unsubscribe fn. */
export function onAppFocus(fn: (e: AppFocusEvent) => void): () => void {
  focusListeners.add(fn);
  return () => {
    focusListeners.delete(fn);
  };
}

/**
 * One shared EventSource for every useAgentEvents subscriber. The design
 * screen mounts three subscribers (canvas ghosts, agent chat, page-level
 * switches); per-hook connections held 3 SSE streams plus useLiveEvents,
 * starving the browser's 6-per-origin pool until API calls hung. Native
 * reconnect is preserved (no onerror handler, like before).
 */
let sharedAgentSource: EventSource | undefined;
const sharedAgentListeners = new Set<(e: AgentEvent, wid: string) => void>();

/**
 * Subscribes to one workflow's agent events over SSE (useLiveEvents ignores
 * agent events), multiplexed over the shared connection; skipped outside
 * browsers like useEvents.
 */
export function useAgentEvents(workflowId: string, onEvent: (e: AgentEvent) => void): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  }, [onEvent]);
  const widRef = useRef(workflowId);
  useEffect(() => {
    widRef.current = workflowId;
  }, [workflowId]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    if (!sharedAgentSource) {
      const es = new EventSource(apiUrl('/api/events'));
      es.onmessage = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data) as {
          type?: unknown;
          workflowId?: unknown;
          event?: AgentEvent;
        };
        if (data.type === 'agent' && typeof data.workflowId === 'string' && data.event) {
          for (const l of sharedAgentListeners) l(data.event, data.workflowId);
        }
      };
      sharedAgentSource = es;
    }
    const listener = (e: AgentEvent, wid: string) => {
      if (wid === widRef.current) ref.current(e);
    };
    sharedAgentListeners.add(listener);
    return () => {
      sharedAgentListeners.delete(listener);
      if (sharedAgentListeners.size === 0) {
        sharedAgentSource?.close();
        sharedAgentSource = undefined;
      }
    };
  }, []);
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
        await putSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
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
      const raw = JSON.parse(msg.data) as {
        type?: unknown;
        path?: unknown;
        hash?: unknown;
      };
      if (raw.type === 'app-focus' && typeof raw.path === 'string') {
        const event: AppFocusEvent = {
          type: 'app-focus',
          path: raw.path,
          hash: typeof raw.hash === 'string' ? raw.hash : undefined,
        };
        for (const l of focusListeners) {
          try {
            l(event);
          } catch {
            // One bad subscriber must not starve the rest.
          }
        }
        return;
      }
      const e = raw as EngineEvent;
      if (e.type === 'run') {
        void client.invalidateQueries({ queryKey: ['run', e.run.id] });
        void client.invalidateQueries({ queryKey: ['runs', e.run.workflowId] });
      } else if (e.type === 'step') {
        // Step events carry no workflowId, so the runs lists are invalidated
        // by prefix instead of per workflow.
        void client.invalidateQueries({ queryKey: ['run', e.stepRun.runId] });
        void client.invalidateQueries({ queryKey: ['runs'] });
      } else if (e.type === 'mood') {
        // A mood run landed: refetch settings so the backdrop live-updates.
        void client.invalidateQueries({ queryKey: ['settings'] });
      } else if (e.type === 'notify') {
        // A notify step's in-app toast. Agent envelopes also arrive on this
        // stream but carry no EngineEvent type, so they fall through silently.
        toast(e.text);
      }
    };
    const connect = () => {
      if (closed) return;
      // This stream is always on while the app is open, so it doubles as
      // the desktop-presence signal: Tauri webviews tag it for /api/app/focus.
      es = new EventSource(apiUrl('/api/events') + (isTauri() ? '?client=tauri' : ''));
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
