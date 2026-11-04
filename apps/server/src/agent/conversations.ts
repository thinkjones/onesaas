import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Database } from '../db/connection.js';
import { conversations } from '../db/schema.js';
import type { AgentMessage } from '../models/gateway.js';

// Column names here MUST match src/db/schema.ts exactly (snake_case).
// A brand-new table, so CREATE TABLE IF NOT EXISTS is the whole migration —
// there are no existing DBs to ALTER (unlike the Task 3 `kind` backfill).
const DDL = `
CREATE TABLE IF NOT EXISTS "conversations" (
  "workflow_id" TEXT NOT NULL PRIMARY KEY,
  "messages" TEXT NOT NULL,
  "transcript" TEXT NOT NULL DEFAULT '[]',
  "updated_at" TEXT NOT NULL
);
`;

/** One visible transcript row: the owner's sends plus the agent's `say` and `ask`. */
export interface TranscriptEntry {
  role: 'owner' | 'agent';
  text: string;
  ask?: { question: string; options: string[] };
  at: number;
}

export interface Conversation {
  /** The model history: user + assistant + tool results + owner-edit notes. */
  messages: AgentMessage[];
  /** The visible transcript served by GET /api/workflows/:id/agent. */
  transcript: TranscriptEntry[];
}

export interface ConversationStore {
  load(workflowId: string): Conversation | undefined;
  save(workflowId: string, c: Conversation): void;
  remove(workflowId: string): void;
}

/**
 * Chats saved under the product's earlier name: visible replies and the model's
 * history would otherwise keep using it. Only touches text the app or the agent
 * wrote, never what the owner typed, and matches nothing once it has run.
 */
function renameSavedChats(db: Database): void {
  const reply = (text: string): string =>
    text
      .replace(/,\s*Dad(?=[!.?])/g, '')
      .replace(/\bDad's\b/g, 'your')
      .replace(/\bDad\b/g, 'you');
  const note = (text: string): string =>
    text
      .replace(/\bDad's\b/g, "the owner's")
      .replace(/^Dad\b/, 'The owner')
      .replace(/\bDad\b/g, 'the owner')
      .replace('wait for his reply', 'wait for their reply');
  const rows = db
    .prepare(`SELECT workflow_id, messages, transcript FROM conversations WHERE transcript LIKE '%"dad"%' OR messages LIKE '%Dad%' OR transcript LIKE '%Dad%'`)
    .all() as { workflow_id: string; messages: string; transcript: string }[];
  const save = db.prepare(`UPDATE conversations SET messages = ?, transcript = ? WHERE workflow_id = ?`);
  for (const row of rows) {
    const transcript = (JSON.parse(row.transcript) as { role: string; text: string; ask?: { question: string } }[]).map((e) => {
      if (e.role === 'dad') return { ...e, role: 'owner' };
      if (e.role !== 'agent') return e;
      return { ...e, text: reply(e.text), ...(e.ask ? { ask: { ...e.ask, question: reply(e.ask.question) } } : {}) };
    });
    const messages = (JSON.parse(row.messages) as { role: string; content?: unknown }[]).map((m) => {
      if (typeof m.content !== 'string' || m.role === 'user') return m;
      return { ...m, content: m.role === 'assistant' ? reply(m.content) : note(m.content) };
    });
    save.run(JSON.stringify(messages), JSON.stringify(transcript), row.workflow_id);
  }
}

export function createConversationStore(db: Database): ConversationStore {
  db.exec(DDL);
  renameSavedChats(db);
  const orm = drizzle(db);

  return {
    load(workflowId: string): Conversation | undefined {
      const row = orm.select().from(conversations).where(eq(conversations.workflowId, workflowId)).get();
      if (!row) return undefined;
      return {
        messages: JSON.parse(row.messages) as AgentMessage[],
        transcript: JSON.parse(row.transcript) as TranscriptEntry[],
      };
    },

    save(workflowId: string, c: Conversation): void {
      orm
        .insert(conversations)
        .values({
          workflowId,
          messages: JSON.stringify(c.messages),
          transcript: JSON.stringify(c.transcript),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: conversations.workflowId,
          set: {
            messages: JSON.stringify(c.messages),
            transcript: JSON.stringify(c.transcript),
            updatedAt: new Date().toISOString(),
          },
        })
        .run();
    },

    remove(workflowId: string): void {
      orm.delete(conversations).where(eq(conversations.workflowId, workflowId)).run();
    },
  };
}
