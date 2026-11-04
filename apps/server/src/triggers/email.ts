import type { Run, TriggerMsg } from '@onesaas/shared';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import type { Repo } from '../db/repo.js';
import type { Gateway } from '../models/gateway.js';

// The inbox watcher sends trigger { triggerType: 'email', workflowId: '*',
// payload } for every new unread thread; this module fans it out to every ON
// workflow with a trigger.email. Dedupe is the seen_emails table (thread_id
// PK): INSERT OR IGNORE is atomic, so concurrent duplicates still start one
// run with no in-memory guard to lose on restart.

// Narrow structural surfaces so fakes stay small; the real bridge, engine,
// repo, gateway, and db satisfy these.
export interface EmailTriggerBridge {
  onTrigger(fn: (t: TriggerMsg) => void): void;
}

export interface EmailTriggerEngine {
  start: (workflowId: string, triggerPayload: unknown) => Promise<Run>;
}

export const TRIAGE_SYSTEM_PROMPT =
  'You triage incoming email for a small business owner. Reply only with the JSON schema given.';

const triageSchema = z.object({
  isCustomer: z
    .boolean()
    .describe('True when this email is from a customer or potential customer, not spam or a newsletter.'),
  why: z.string().describe('One plain-English sentence explaining the call, with no jargon.'),
});

export function registerEmailTrigger(d: {
  bridge: EmailTriggerBridge;
  engine: EmailTriggerEngine;
  repo: Repo;
  gateway: Gateway;
  db: Database;
}): void {
  const { bridge, engine, repo, gateway, db } = d;
  const markSeen = db.prepare(
    'INSERT OR IGNORE INTO "seen_emails" ("thread_id", "seen_at") VALUES (?, ?)',
  );
  const unsee = db.prepare('DELETE FROM "seen_emails" WHERE "thread_id" = ?');
  // Transient failure (triage exception, start rejection) frees the thread so
  // a reload retries it; only a definitive verdict keeps the dedupe row. The
  // delete itself is best-effort — a failing store already skips fan-out.
  const freeForRetry = (threadId: string): void => {
    try {
      unsee.run(threadId);
    } catch {
      // The store is failing; the row stays and the email is skipped.
    }
  };

  bridge.onTrigger((t) => {
    if (t.triggerType !== 'email') return;
    // The handler is async (triage awaits the model); the bridge takes sync
    // handlers, so the promise is contained here. Every failure path is
    // caught: a bad email must never reject out of the socket handler.
    void handle(t).catch(() => {});
  });

  async function handle(t: TriggerMsg): Promise<void> {
    const flat = (t.payload ?? {}) as Record<string, unknown>;
    const threadId = String(flat['threadId'] ?? '');
    if (threadId === '') return; // No identity, no dedupe: skip, don't poison seen_emails.
    let inserted: unknown;
    try {
      inserted = markSeen.run(threadId, new Date().toISOString());
    } catch {
      return; // The store itself is failing: skip rather than fan out blind.
    }
    // changes === 0 means the thread was already seen: skip, no run.
    if ((inserted as { changes: number }).changes === 0) return;

    const subject = String(flat['subject'] ?? '');
    const snippet = String(flat['snippet'] ?? '');
    const email = {
      threadId: flat['threadId'],
      from: flat['from'],
      fromName: flat['fromName'],
      subject: flat['subject'],
      snippet: flat['snippet'],
    };

    for (const wf of repo.listWorkflows()) {
      if (wf.status !== 'on') continue;
      if (wf.trigger.type !== 'trigger.email') continue;
      const config = wf.trigger.config as Record<string, unknown>;
      // Substring filter first (subject OR snippet, case-insensitive), so a
      // non-matching email triages nothing.
      const matching = config['matching'];
      if (typeof matching === 'string' && matching !== '') {
        const needle = matching.toLowerCase();
        if (!subject.toLowerCase().includes(needle) && !snippet.toLowerCase().includes(needle)) {
          continue;
        }
      }
      // Catalog defaults never apply at runtime (guard-only schemas), so the
      // onlyCustomerEmails default (true) is applied manually here.
      if ((config['onlyCustomerEmails'] as boolean | undefined) ?? true) {
        let customer: boolean;
        try {
          // Subject + snippet ONLY: the full body is never sent to triage.
          const triaged = await gateway.chatJson({
            role: 'triage',
            system: TRIAGE_SYSTEM_PROMPT,
            user: `Subject: ${subject}\nSnippet: ${snippet}`,
            schema: triageSchema,
            schemaName: 'email_triage',
          });
          customer = triaged.data.isCustomer;
        } catch (err) {
          // A failed triage skips this workflow's run (other workflows still
          // get their own triage). Surfaced on stderr, not swallowed silent,
          // and the thread is freed: a transient outage must retry on reload.
          // Only a definitive isCustomer:false verdict keeps the dedupe row.
          console.error('[email-trigger] triage failed:', err);
          freeForRetry(threadId);
          continue;
        }
        if (!customer) continue;
      }
      // Unlike gmailButton (whose run row always exists because start() got
      // that far), engine.start can throw BEFORE any run row exists — Unknown
      // workflow (deleted between list and start), Unknown step type — so a
      // rejection is logged loud and the thread is freed for a reload retry.
      try {
        await engine.start(wf.id, { email });
      } catch (err) {
        console.error('[email-trigger] start failed:', err);
        freeForRetry(threadId);
      }
    }
  }
}
