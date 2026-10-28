import { useEffect, useRef } from 'react';
import type { Run, StepRun, Workflow } from '@dad/shared';

// Mirrors apps/server/src/engine/events.ts. The web package cannot import it
// (server is not a dependency), so the shape is redeclared here.
export type EngineEvent = { type: 'run'; run: Run } | { type: 'step'; stepRun: StepRun };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
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

export function getRun(id: string): Promise<{ run: Run; steps: StepRun[] }> {
  return getJson(`/api/runs/${encodeURIComponent(id)}`);
}

export async function startPairing(): Promise<{ code: string }> {
  const res = await fetch('/api/pairing/start', { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
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
