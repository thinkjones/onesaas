import type { EventEmitter } from 'node:events';
import type { Run, ServerToExtension, TriggerMsg } from '@onesaas/shared';
import type { Repo } from '../db/repo.js';
import type { EngineEvent } from '../engine/events.js';

// Task 10 contract: the extension sends trigger payloads FLAT —
// { from, fromName, subject, body, threadId }. This module wraps them into
// { email: {...} } for engine.start, because the trigger.gmailButton output
// schema is { email } and the engine validates the trigger step against it.
// The payload is NOT pre-validated here: a malformed payload fails the
// trigger step cleanly with a visible reason, which is better observability
// than a silent drop.

// Narrow structural surfaces so fakes stay small; the real bridge and engine
// satisfy these (the engine's start takes exactly (workflowId, payload)).
export interface GmailButtonBridge {
  send(msg: ServerToExtension): void;
  onTrigger(fn: (t: TriggerMsg) => void): void;
  onReady(fn: () => void): void;
}

export interface GmailButtonEngine {
  start: (workflowId: string, triggerPayload: unknown) => Promise<Run>;
  events: EventEmitter;
}

export function registerGmailButtonTrigger(d: {
  bridge: GmailButtonBridge;
  engine: GmailButtonEngine;
  repo: Repo;
}): void {
  const { bridge, engine, repo } = d;
  // Dedup: one in-flight run per workflow + thread. The key is removed in a
  // finally once start() settles, so a later click starts a fresh run.
  const inFlight = new Set<string>();

  bridge.onReady(() => {
    // Full-list resend on every hello (including re-hello) is idempotent: the
    // extension replaces its button set, so repeats converge on the same list.
    const items = repo
      .listWorkflows()
      .filter((w) => w.status === 'on' && w.trigger.type === 'trigger.gmailButton')
      .map((w) => {
        // A missing/empty label falls back to the workflow NAME — never
        // String(undefined), which would render as the literal 'undefined'.
        const l = w.trigger.config['label'];
        return { workflowId: w.id, label: typeof l === 'string' && l ? l : w.name };
      });
    bridge.send({ type: 'buttons', items });
  });

  bridge.onTrigger((t) => {
    const wf = repo.getWorkflow(t.workflowId);
    // Ignore unknown workflows (stale button after a delete/rename).
    if (!wf) return;
    // Ignore workflows that are no longer on (toggled off since the last hello).
    if (wf.status !== 'on') return;
    // Ignore workflows whose trigger is no longer the Gmail button.
    if (wf.trigger.type !== 'trigger.gmailButton') return;

    const flat = (t.payload ?? {}) as Record<string, unknown>;
    // Missing threadId coalesces under one key — the safe direction: one
    // run at a time for unidentified threads rather than unbounded clicks.
    const threadId = String(flat['threadId'] ?? '');
    const key = JSON.stringify([t.workflowId, threadId]);
    if (inFlight.has(key)) return;
    inFlight.add(key);
    // M1 runs otherwise never reject: the engine's finalizer already failed
    // the run row and emitted the terminal run event before an infra failure
    // rejects start(). The catch swallows those infra rejections; without it
    // they would surface as unhandled rejections from this handler.
    engine
      .start(t.workflowId, {
        email: {
          from: flat['from'],
          fromName: flat['fromName'],
          subject: flat['subject'],
          body: flat['body'],
          threadId: flat['threadId'],
        },
      })
      .catch(() => {})
      .finally(() => {
        inFlight.delete(key);
      });
  });

  // Subscribed ONCE at register: every run event (running + terminal) drives
  // the Gmail pill. Step events are not forwarded. Like other bridge.send
  // callers, the payload is built, not self-validated against the schema.
  engine.events.on('event', (e: EngineEvent) => {
    if (e.type !== 'run') return;
    const run = e.run;
    const email = (run.triggerPayload as { email?: { threadId?: unknown } } | undefined)?.email;
    bridge.send({
      type: 'runStatus',
      workflowId: run.workflowId,
      threadId: String(email?.threadId ?? ''),
      runId: run.id,
      status: run.status,
    });
  });
}
