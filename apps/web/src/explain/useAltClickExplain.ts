import { useEffect, useState } from 'react';
import type { ExplainTarget } from '../api.ts';

// Alt-click "explain anything": elements carrying
// data-explain='{"kind":…,"id":…,"context":…,"label":…}' explain themselves
// when alt-clicked. The hook owns the listener + open state; the floating
// popover itself lives in Explain.tsx (this file stays JSX-free). The
// "Tell me more" message + event live here too: a component file may only
// export components (fast-refresh lint), so shared helpers belong here.

/**
 * Window event fired when "Tell me more" has no direct handler. WorkflowPage
 * listens: it opens the helper panel and sends the message. Outside the
 * workflow page TellMeMoreFallback (mounted in AppShell) routes to a panel.
 */
export const TELL_ME_MORE_EVENT = 'onesaas:tell-me-more';

export function tellMeMoreMessage(label: string): string {
  return `Tell me more about ${label}`;
}

export function dispatchTellMeMore(label: string): void {
  window.dispatchEvent(
    new CustomEvent(TELL_ME_MORE_EVENT, { detail: { message: tellMeMoreMessage(label) } }),
  );
}

/**
 * Where the popover opened, and what it explains. The wire body (`target`)
 * stays a BARE ExplainTarget — the server's ExplainBody is `.strict()`, so
 * view fields (label, x, y) must never ride along on the POST.
 */
export interface AltClickOpen {
  target: ExplainTarget;
  label: string;
  x: number;
  y: number;
}

/** A parsed data-explain value: the wire target plus its human label. */
export interface ParsedDataExplain {
  target: ExplainTarget;
  label: string;
}

/** Builds the data-explain attribute value for a target + human label. */
export function dataExplainValue(target: ExplainTarget, label: string): string {
  return JSON.stringify({ ...target, label });
}

/**
 * Parses a data-explain value; null when absent or malformed. Returns the
 * wire target SEPARATE from the label, so the over-wide attribute object
 * can't typecheck as a request body (the server rejects surplus keys).
 */
export function parseDataExplain(raw: string | null): ParsedDataExplain | null {
  if (raw === null || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    v['kind'] !== 'step' &&
    v['kind'] !== 'run' &&
    v['kind'] !== 'table' &&
    v['kind'] !== 'column' &&
    v['kind'] !== 'ui'
  ) {
    return null;
  }
  if (typeof v['label'] !== 'string' || v['label'] === '') return null;
  if (v['id'] !== undefined && typeof v['id'] !== 'string') return null;
  if (v['context'] !== undefined && typeof v['context'] !== 'string') return null;
  const target: ExplainTarget = {
    kind: v['kind'],
    ...(typeof v['id'] === 'string' ? { id: v['id'] } : {}),
    ...(typeof v['context'] === 'string' ? { context: v['context'] } : {}),
  };
  return { target, label: v['label'] };
}

/**
 * Global alt-click listener (capture, so canvas rows and sheet content don't
 * swallow it): alt-clicking the nearest [data-explain] ancestor opens the
 * popover at the pointer. Mounted once via AltClickExplainRoot in App.
 */
export function useAltClickExplain(): { at: AltClickOpen | null; close(): void } {
  const [at, setAt] = useState<AltClickOpen | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (!e.altKey) return;
      const el = (e.target as Element | null)?.closest?.('[data-explain]');
      if (!(el instanceof HTMLElement)) return;
      const parsed = parseDataExplain(el.getAttribute('data-explain'));
      if (!parsed) return;
      e.preventDefault();
      e.stopPropagation();
      setAt({ target: parsed.target, label: parsed.label, x: e.clientX, y: e.clientY });
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);
  return { at, close: () => setAt(null) };
}
