import type { Executor } from './registry.js';

// M1 placement: the gmail executors live here alongside the triggers, per the
// plan's 4-file structure. M4 splits per-site modules (gmail/calendar/meta).

// Trigger contract: Task 7 calls trigger executors with the raw trigger
// payload as input, and they echo it as output. For gmailButton the engine
// supplies { email }-shaped input; for manual, { payload }-shaped input.

function senderBits(email: unknown): { fromName: string; subject: string } {
  const mail = (email ?? {}) as Record<string, unknown>;
  const fromName = mail['fromName'] ?? mail['from'] ?? 'someone';
  const subject = mail['subject'] ?? '(no subject)';
  return { fromName: String(fromName), subject: String(subject) };
}

export const gmailButtonExecutor: Executor = async (_config, input, _ctx) => {
  const { fromName, subject } = senderBits(
    (input as Record<string, unknown> | null | undefined)?.['email'],
  );
  return { output: input, why: `Started by an email from ${fromName} ("${subject}").` };
};

export const manualExecutor: Executor = async (_config, input, _ctx) => {
  return { output: input, why: 'Started manually.' };
};

export const emailExecutor: Executor = async (_config, input, _ctx) => {
  const { fromName, subject } = senderBits(
    (input as Record<string, unknown> | null | undefined)?.['email'],
  );
  return { output: input, why: `A new email arrived from ${fromName} ("${subject}").` };
};

export const uploadExecutor: Executor = async (_config, input, _ctx) => {
  return { output: input, why: 'Started with your photo.' };
};

export const readExecutor: Executor = async (_config, input, ctx) => {
  // Worker tab: the extension navigates its pinned background Gmail tab to
  // this thread and reads it there, so the owner's view never moves.
  const out = (await ctx.bridge.call(
    'gmail',
    'readOpenEmail',
    {
      threadId: (input as { threadId: string }).threadId,
    },
    undefined,
    { tab: 'worker' },
  )) as Record<string, unknown>;
  // The bridge already returns the email shape; pass it through (the engine
  // validates it against the shared email schema).
  const { fromName, subject } = senderBits(out);
  return { output: out, why: `Read the email from ${fromName} ("${subject}").` };
};

export const draftReplyExecutor: Executor = async (_config, input, ctx) => {
  const { threadId, body } = input as { threadId: string; body: string };
  await ctx.bridge.call('gmail', 'draftReply', { threadId, body });
  return { output: { drafted: true }, why: 'Saved the reply as a draft in Gmail.' };
};

// Test-mode preview: describes the draft without touching Gmail.
draftReplyExecutor.preview = async () => {
  return {
    output: { drafted: true },
    why: 'In a real run I would put this reply into Gmail as a draft.',
  };
};
