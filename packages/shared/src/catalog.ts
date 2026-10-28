import { z } from 'zod';
import { columnTypeSchema } from './columns.js';

export type StepKind = 'trigger' | 'fetch' | 'enrich' | 'store' | 'act';

export interface StepDef {
  type: string;
  kind: StepKind;
  title: string;
  configSchema: z.ZodTypeAny;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
}

// The one email shape. The gmailButton trigger wraps it as { email } (the
// extension reads a full email when the button is clicked); gmail.read returns
// it bare, because the extension's readOpenEmail already returns exactly this
// object. Both outputs share this schema object literally.
export const emailSchema = z.object({
  from: z.string(),
  fromName: z.string(),
  subject: z.string(),
  body: z.string(),
  threadId: z.string(),
});

export const catalog: Record<string, StepDef> = {
  'trigger.gmailButton': {
    type: 'trigger.gmailButton',
    kind: 'trigger',
    title: 'Gmail button',
    configSchema: z.object({ label: z.string() }),
    inputSchema: z.object({}),
    outputSchema: z.object({ email: emailSchema }),
  },
  'trigger.manual': {
    type: 'trigger.manual',
    kind: 'trigger',
    title: 'Manual trigger',
    configSchema: z.object({}),
    inputSchema: z.object({}),
    outputSchema: z.object({ payload: z.unknown() }),
  },
  'ai.extract': {
    type: 'ai.extract',
    kind: 'enrich',
    title: 'Extract details',
    configSchema: z.object({
      instructions: z.string(),
      fields: z
        .array(
          z.object({
            name: z.string(),
            type: columnTypeSchema,
            description: z.string(),
          }),
        )
        .min(1),
    }),
    inputSchema: z.object({ text: z.string() }),
    // DYNAMIC per config: a static schema cannot express "an object with these
    // fields". Exact per-field validation happens in the executor via the
    // schema it builds from config.fields; the engine's output check against
    // this is only a loose object-shape guard.
    outputSchema: z.record(z.string(), z.unknown()),
  },
  'ai.write': {
    type: 'ai.write',
    kind: 'enrich',
    title: 'Write text',
    configSchema: z.object({
      instructions: z.string(),
      tone: z.enum(['friendly', 'formal', 'brief']),
    }),
    // `context` is whatever the previous step produced (usually the extract
    // output object), so unknown is the most forgiving accurate type.
    inputSchema: z.object({ context: z.unknown() }),
    outputSchema: z.object({ text: z.string() }),
  },
  'table.upsert': {
    type: 'table.upsert',
    kind: 'store',
    title: 'Save to list',
    configSchema: z.object({ table: z.string(), keyField: z.string() }),
    inputSchema: z.object({ row: z.record(z.string(), z.unknown()) }),
    outputSchema: z.object({ id: z.number(), created: z.boolean() }),
  },
  'gmail.read': {
    type: 'gmail.read',
    kind: 'fetch',
    title: 'Read email',
    configSchema: z.object({}),
    inputSchema: z.object({ threadId: z.string() }),
    outputSchema: emailSchema,
  },
  'gmail.draftReply': {
    type: 'gmail.draftReply',
    kind: 'act',
    title: 'Draft reply',
    configSchema: z.object({}),
    inputSchema: z.object({ threadId: z.string(), body: z.string() }),
    outputSchema: z.object({ drafted: z.literal(true) }),
  },
  'approval.ask': {
    type: 'approval.ask',
    kind: 'act',
    title: 'Ask for approval',
    // The engine validates schemas as guards only (originals flow through),
    // so this .default() NEVER applies at runtime: the approval executor
    // must apply it manually (config.question ?? 'Is this OK to use?').
    // Same caveat for any future catalog default.
    configSchema: z.object({ question: z.string().default('Is this OK to use?') }),
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string(), decision: z.enum(['approved', 'edited']) }),
  },
};
