import { z } from 'zod';
import { RunStatus } from './run.js';

// Directions:
//   extension -> server: pair, hello, trigger, result, ping, pong(id)
//   server -> extension: paired, ready, buttons, cmd, runStatus, pong, ping(id)

export const PairMessage = z.object({ type: z.literal('pair'), code: z.string() });
export type PairMessage = z.infer<typeof PairMessage>;

export const PairedMessage = z.object({ type: z.literal('paired'), token: z.string() });
export type PairedMessage = z.infer<typeof PairedMessage>;

export const HelloMessage = z.object({
  type: z.literal('hello'),
  token: z.string(),
  // Optional so old hellos still parse; identifies the peer in the app UI.
  client: z.object({ profileEmail: z.string().optional() }).optional(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

export const WorkflowButton = z.object({ workflowId: z.string(), label: z.string() });
export type WorkflowButton = z.infer<typeof WorkflowButton>;

export const ReadyMessage = z.object({ type: z.literal('ready'), buttons: z.array(WorkflowButton) });
export type ReadyMessage = z.infer<typeof ReadyMessage>;

export const ButtonsMessage = z.object({ type: z.literal('buttons'), items: z.array(WorkflowButton) });
export type ButtonsMessage = z.infer<typeof ButtonsMessage>;

export const CmdTab = z.enum(['worker', 'active']);
export type CmdTab = z.infer<typeof CmdTab>;

export const CmdMessage = z.object({
  type: z.literal('cmd'),
  id: z.string(),
  site: z.enum(['gmail', 'calendar', 'meta']),
  action: z.string(),
  input: z.unknown(),
  // Optional so old senders still parse; missing means 'active'.
  tab: CmdTab.optional(),
});
export type CmdMessage = z.infer<typeof CmdMessage>;

export const ResultOkMessage = z.object({ type: z.literal('result'), id: z.string(), ok: z.literal(true), output: z.unknown() });
export type ResultOkMessage = z.infer<typeof ResultOkMessage>;

// Machine-readable failure reason. Optional so old senders still parse;
// the human-readable `error` string is always present and unchanged.
export const ResultErrorCode = z.enum(['SELECTOR_MISSING', 'NOT_OPEN', 'TIMEOUT', 'HANDOFF']);
export type ResultErrorCode = z.infer<typeof ResultErrorCode>;

export const ResultErrMessage = z.object({
  type: z.literal('result'),
  id: z.string(),
  ok: z.literal(false),
  error: z.string(),
  code: ResultErrorCode.optional(),
});
export type ResultErrMessage = z.infer<typeof ResultErrMessage>;

// The two result variants share `type: 'result'`, so they form their own
// discriminated union on `ok`, nested inside the top-level `z.union`s below.
export const ResultMessage = z.discriminatedUnion('ok', [ResultOkMessage, ResultErrMessage]);
export type ResultMessage = z.infer<typeof ResultMessage>;

export const TriggerMessage = z.object({
  type: z.literal('trigger'),
  workflowId: z.string(),
  // gmailButton: one workflow's button click. email: the inbox watcher fans
  // out with workflowId '*' and the server starts every matching workflow.
  triggerType: z.enum(['gmailButton', 'email']),
  payload: z.unknown(),
});
export type TriggerMessage = z.infer<typeof TriggerMessage>;
export type TriggerMsg = TriggerMessage;

export const RunStatusMessage = z.object({
  type: z.literal('runStatus'),
  workflowId: z.string(),
  threadId: z.string(),
  runId: z.string(),
  status: RunStatus,
});
export type RunStatusMessage = z.infer<typeof RunStatusMessage>;

export const PingMessage = z.object({ type: z.literal('ping') });
export type PingMessage = z.infer<typeof PingMessage>;

export const PongMessage = z.object({ type: z.literal('pong') });
export type PongMessage = z.infer<typeof PongMessage>;

// Correlated server -> extension ping (the app's "is Chrome really there?"
// check) and its reply. The bare ping/pong keep-alive pair is unchanged.
export const ServerPingMessage = z.object({ type: z.literal('ping'), id: z.string() });
export type ServerPingMessage = z.infer<typeof ServerPingMessage>;

export const PongReplyMessage = z.object({ type: z.literal('pong'), id: z.string() });
export type PongReplyMessage = z.infer<typeof PongReplyMessage>;

// PongReplyMessage precedes PongMessage: zod tries variants in order and
// PongMessage would strip the id off a correlated reply.
export const ExtensionToServer = z.union([PairMessage, HelloMessage, TriggerMessage, ResultMessage, PingMessage, PongReplyMessage, PongMessage]);
export type ExtensionToServer = z.infer<typeof ExtensionToServer>;

export const ServerToExtension = z.union([PairedMessage, ReadyMessage, ButtonsMessage, CmdMessage, RunStatusMessage, PongMessage, ServerPingMessage]);
export type ServerToExtension = z.infer<typeof ServerToExtension>;
