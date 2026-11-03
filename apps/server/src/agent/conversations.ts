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

/** One visible transcript row: Dad's sends plus the agent's `say` and `ask`. */
export interface TranscriptEntry {
  role: 'dad' | 'agent';
  text: string;
  ask?: { question: string; options: string[] };
  at: number;
}

export interface Conversation {
  /** The model history: user + assistant + tool results + Dad-edit notes. */
  messages: AgentMessage[];
  /** The visible transcript served by GET /api/workflows/:id/agent. */
  transcript: TranscriptEntry[];
}

export interface ConversationStore {
  load(workflowId: string): Conversation | undefined;
  save(workflowId: string, c: Conversation): void;
  remove(workflowId: string): void;
}

export function createConversationStore(db: Database): ConversationStore {
  db.exec(DDL);
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
