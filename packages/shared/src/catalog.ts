import { z } from 'zod';
import { columnTypeSchema } from './columns.js';

export type StepKind = 'trigger' | 'fetch' | 'enrich' | 'store' | 'act';

export interface StepDef {
  type: string;
  kind: StepKind;
  title: string;
  /** One plain sentence saying what this step does. Used as a default summary. */
  description: string;
  /** An example output, so the author (and the builder agent) can see the shape. */
  sample?: unknown;
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

// A stored photo: the file store (apps/server/src/files/store.ts) mints these
// for uploads and generated images. Width/height are absent only when the
// bytes' dimensions could not be determined.
export const fileRefSchema = z.object({
  fileId: z.string(),
  mime: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type FileRef = z.infer<typeof fileRefSchema>;

/** The seeded sample photo's id (apps/server/assets/sample-mug.jpg). */
export const SAMPLE_FILE_ID = 'sample-mug';

export const catalog: Record<string, StepDef> = {
  'trigger.gmailButton': {
    type: 'trigger.gmailButton',
    kind: 'trigger',
    title: 'Gmail button',
    description: 'Runs when you click the button on an email in Gmail.',
    sample: {
      email: {
        from: 'priya@acme.co',
        fromName: 'Priya Nair',
        subject: 'Do you cater weekend events?',
        body: 'Hi! We loved your stall at the market. Do you cater small weekend events?',
        threadId: 'thread_abc123',
      },
    },
    configSchema: z.object({ label: z.string() }),
    inputSchema: z.object({}),
    outputSchema: z.object({ email: emailSchema }),
  },
  'trigger.manual': {
    type: 'trigger.manual',
    kind: 'trigger',
    title: 'Manual trigger',
    description: 'Runs when you start it by hand.',
    sample: { payload: { hello: 'world' } },
    configSchema: z.object({}),
    inputSchema: z.object({}),
    outputSchema: z.object({ payload: z.unknown() }),
  },
  'trigger.email': {
    type: 'trigger.email',
    kind: 'trigger',
    title: 'New email',
    description: 'Runs when a new customer email arrives.',
    sample: {
      email: {
        from: 'jordan@example.com',
        fromName: 'Jordan Lee',
        subject: 'Booking for Saturday evening',
        snippet: 'Hi! Can I book a table for 4 this Saturday at 7pm? Thanks!',
        threadId: 'thread_booking_001',
      },
    },
    // The engine validates schemas as guards only (originals flow through),
    // so this .default() NEVER applies at runtime: the email trigger module
    // must apply it manually (config.onlyCustomerEmails ?? true). Same
    // caveat as approval.ask's question default.
    configSchema: z.object({
      onlyCustomerEmails: z.boolean().default(true),
      matching: z.string().optional(),
    }),
    inputSchema: z.object({}),
    // No body: the inbox watcher reads list rows, which carry no message
    // text. Flows that need the body add a gmail.read step on the threadId.
    outputSchema: z.object({
      email: z.object({
        threadId: z.string(),
        from: z.string(),
        fromName: z.string(),
        subject: z.string(),
        snippet: z.string(),
      }),
    }),
  },
  'ai.classify': {
    type: 'ai.classify',
    kind: 'enrich',
    title: 'Sort into options',
    description: 'Sorts text into one of your options.',
    configSchema: z.object({
      question: z.string(),
      // Guard-only default (see trigger.email above): the executor applies
      // (config.options ?? ['yes', 'no']) manually.
      options: z.array(z.string()).default(['yes', 'no']),
    }),
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ choice: z.string() }),
  },
  'ai.extract': {
    type: 'ai.extract',
    kind: 'enrich',
    title: 'Extract details',
    description: 'Reads details out of text.',
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
    description: 'Writes text in the tone you choose.',
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
    description: 'Saves a row to one of your lists.',
    configSchema: z.object({ table: z.string(), keyField: z.string() }),
    inputSchema: z.object({ row: z.record(z.string(), z.unknown()) }),
    outputSchema: z.object({ id: z.number(), created: z.boolean() }),
  },
  'table.insert': {
    type: 'table.insert',
    kind: 'store',
    title: 'Add to list',
    description: 'Adds a new row to one of your lists.',
    configSchema: z.object({ table: z.string() }),
    inputSchema: z.object({ row: z.record(z.string(), z.unknown()) }),
    outputSchema: z.object({ id: z.number() }),
  },
  'table.query': {
    type: 'table.query',
    kind: 'fetch',
    title: 'Find rows',
    description: 'Finds rows in one of your lists.',
    // Guard-only default (see trigger.email above): the executor applies
    // (config.limit ?? 20) manually.
    configSchema: z.object({ table: z.string(), limit: z.number().default(20) }),
    inputSchema: z.object({ where: z.record(z.string(), z.unknown()).optional() }),
    outputSchema: z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      count: z.number(),
    }),
  },
  'gmail.read': {
    type: 'gmail.read',
    kind: 'fetch',
    title: 'Read email',
    description: 'Reads an email from Gmail.',
    configSchema: z.object({}),
    inputSchema: z.object({ threadId: z.string() }),
    outputSchema: emailSchema,
  },
  'gmail.draftReply': {
    type: 'gmail.draftReply',
    kind: 'act',
    title: 'Draft reply',
    description: 'Drafts a reply in Gmail.',
    configSchema: z.object({}),
    inputSchema: z.object({ threadId: z.string(), body: z.string() }),
    outputSchema: z.object({ drafted: z.literal(true) }),
  },
  'calendar.freeBusy': {
    type: 'calendar.freeBusy',
    kind: 'fetch',
    title: 'Check calendar',
    description: 'Checks whether a time is free on your calendar.',
    configSchema: z.object({}),
    inputSchema: z.object({ start: z.string(), end: z.string() }),
    outputSchema: z.object({
      free: z.boolean(),
      clashes: z.array(z.object({ title: z.string(), start: z.string(), end: z.string() })),
    }),
  },
  'calendar.createEvent': {
    type: 'calendar.createEvent',
    kind: 'act',
    title: 'Add calendar event',
    description: 'Adds an event to your calendar.',
    configSchema: z.object({ titleTemplate: z.string().optional() }),
    inputSchema: z.object({
      title: z.string(),
      start: z.string(),
      end: z.string(),
      details: z.string().optional(),
    }),
    outputSchema: z.object({ created: z.boolean() }),
  },
  'approval.ask': {
    type: 'approval.ask',
    kind: 'act',
    title: 'Ask for approval',
    description: 'Asks you to approve something before continuing.',
    // The engine validates schemas as guards only (originals flow through),
    // so this .default() NEVER applies at runtime: the approval executor
    // must apply it manually (config.question ?? 'Is this OK to use?').
    // Same caveat for any future catalog default.
    configSchema: z.object({ question: z.string().default('Is this OK to use?') }),
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string(), decision: z.enum(['approved', 'edited']) }),
  },
  'trigger.upload': {
    type: 'trigger.upload',
    kind: 'trigger',
    title: 'Photo upload',
    description: 'Runs when you drop a photo.',
    sample: {
      file: { fileId: SAMPLE_FILE_ID, mime: 'image/jpeg', width: 1200, height: 900 },
    },
    // Guard-only default (see trigger.email above): the web drop zone reads
    // (config.prompt ?? 'Drop a photo here') manually.
    configSchema: z.object({ prompt: z.string().default('Drop a photo here') }),
    inputSchema: z.object({}),
    outputSchema: z.object({ file: fileRefSchema, note: z.string().optional() }),
  },
  'image.cutout': {
    type: 'image.cutout',
    kind: 'enrich',
    title: 'Cut out an object',
    description: 'Cuts an object out of your photo.',
    sample: {
      file: { fileId: 'generated_abc123', mime: 'image/png', width: 400, height: 400 },
    },
    configSchema: z.object({ thing: z.string() }),
    inputSchema: z.object({ file: fileRefSchema }),
    outputSchema: z.object({ file: fileRefSchema }),
  },
  'image.generate': {
    type: 'image.generate',
    kind: 'enrich',
    title: 'Generate a picture',
    description: 'Makes a new picture in a style you choose.',
    sample: {
      file: { fileId: 'generated_def456', mime: 'image/png', width: 1024, height: 1024 },
    },
    configSchema: z.object({ style: z.string() }),
    inputSchema: z.object({ text: z.string().optional(), reference: fileRefSchema.optional() }),
    outputSchema: z.object({ file: fileRefSchema }),
  },
  'image.edit': {
    type: 'image.edit',
    kind: 'enrich',
    title: 'Edit a photo',
    description: 'Edits your photo following your instruction.',
    sample: {
      file: { fileId: 'generated_789abc', mime: 'image/png', width: 1200, height: 900 },
    },
    configSchema: z.object({ instruction: z.string() }),
    inputSchema: z.object({ file: fileRefSchema }),
    outputSchema: z.object({ file: fileRefSchema }),
  },
  'meta.draftPost': {
    type: 'meta.draftPost',
    kind: 'act',
    title: 'Prepare Facebook post',
    description: 'Opens a new post in Meta Business Suite with your text and photo.',
    configSchema: z.object({}),
    inputSchema: z.object({ text: z.string(), image: fileRefSchema.optional() }),
    outputSchema: z.object({ prepared: z.literal(true) }),
  },
  notify: {
    type: 'notify',
    kind: 'act',
    title: 'Show a message',
    description: 'Shows you a message.',
    configSchema: z.object({}),
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ notified: z.literal(true) }),
  },
  'code.transform': {
    type: 'code.transform',
    kind: 'enrich',
    title: 'Calculate',
    description: 'Calculates new values from an earlier step.',
    sample: { total: 120 },
    configSchema: z.object({
      explanation: z.string(),
      code: z.string(),
      outputFields: z
        .array(
          z.object({
            name: z.string(),
            type: columnTypeSchema,
          }),
        )
        .min(1),
    }),
    inputSchema: z.object({ value: z.unknown() }),
    // DYNAMIC per config (same caveat as ai.extract): exact per-field
    // validation happens in the executor via the schema it builds from
    // config.outputFields; the engine's output check against this is only a
    // loose object-shape guard.
    outputSchema: z.record(z.string(), z.unknown()),
  },
};
