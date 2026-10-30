import { z } from 'zod';
import { AI_SYSTEM_PROMPT, chatJsonWithSchemaRetry } from './ai.js';
import type { Executor } from './registry.js';

// The catalog default (options ['yes','no']) never applies at runtime — the
// engine validates config schemas as guards only — so the default lives
// here too. Keep the two in sync.
const DEFAULT_OPTIONS = ['yes', 'no'];

export const classifyExecutor: Executor = async (config, input, ctx) => {
  // ctx.signal is accepted but not acted on in M1: the engine never cancels.
  const question = config.question as string;
  const rawOptions = (config.options as unknown[] | undefined) ?? DEFAULT_OPTIONS;
  // Config errors fail BEFORE any model call: nothing billable happens.
  if (
    !Array.isArray(rawOptions) ||
    rawOptions.length === 0 ||
    rawOptions.some((o) => typeof o !== 'string' || o.length === 0)
  ) {
    throw new Error('Set at least one option to sort into.');
  }
  const options = rawOptions as [string, ...string[]];
  // Runtime enum: a model choice outside `options` is a schema error, which
  // the shared retry below retries once before failing readably.
  const schema = z.object({ choice: z.enum(options), why: z.string() });
  const result = await chatJsonWithSchemaRetry(
    ctx.gateway,
    {
      role: 'builder',
      // No date line: sorting needs no clock (only extract/write resolve dates).
      system: AI_SYSTEM_PROMPT,
      user: `${question}\n\nText to sort:\n${input.text as string}`,
      schema,
      schemaName: 'ai_classify',
    },
    'sort',
    () => `I couldn't sort that into one of: ${options.join(', ')}.`,
  );
  return {
    output: { choice: result.data.choice },
    why: result.data.why,
    model: result.model,
    tokens: result.tokens,
    costUsd: result.costUsd,
  };
};
