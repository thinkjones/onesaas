import { z } from 'zod';
import type { ColumnType } from '@dad/shared';
import type { ChatJsonOptions, ChatJsonResult, Gateway } from '../models/gateway.js';
import type { Executor } from './registry.js';

export const AI_SYSTEM_PROMPT =
  'You help a small business owner. Reply only with the JSON schema given. `why` is one plain-English sentence explaining what you did and why, with no jargon.';

interface ExtractField {
  name: string;
  type: ColumnType;
  description: string;
}

function fieldSchema(type: ColumnType): z.ZodTypeAny {
  switch (type) {
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'text':
    case 'date':
      return z.string();
    case 'email':
      // Plain string, NOT .email(): malformed model output must not fail
      // extraction. The table validates emails on write instead.
      return z.string();
    default:
      throw new Error(`Unknown field type: ${type}`);
  }
}

function isSchemaError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Model output did not match schema');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry once on schema errors only, with a 500 ms backoff. Transport and
// other non-schema errors propagate immediately, unwrapped and unretried,
// on both attempts. A second consecutive schema failure becomes a
// plain-English error for the small business owner.
async function chatJsonWithSchemaRetry<T>(
  gateway: Gateway,
  options: ChatJsonOptions<T>,
  verb: 'read' | 'write',
): Promise<ChatJsonResult<T>> {
  try {
    return await gateway.chatJson(options);
  } catch (err) {
    if (!isSchemaError(err)) throw err;
    await sleep(500);
    try {
      return await gateway.chatJson(options);
    } catch (retryErr) {
      if (!isSchemaError(retryErr)) throw retryErr;
      const detail = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`I couldn't ${verb} that properly: ${detail}`);
    }
  }
}

export const extractExecutor: Executor = async (config, input, ctx) => {
  // ctx.signal is accepted but not acted on in M1: the engine never cancels.
  // Kept as a future hook for aborting in-flight model calls.
  const fields = config.fields as ExtractField[];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.name in shape) throw new Error(`Duplicate field: "${field.name}"`);
    // All fields REQUIRED: the model must return every field every time, so a
    // missing field is a schema error (and retried). M3 may add per-field
    // required flags; until then the contract is strict.
    shape[field.name] = fieldSchema(field.type).describe(field.description);
  }
  const schema = z.object({ output: z.object(shape), why: z.string() });
  const result = await chatJsonWithSchemaRetry(
    ctx.gateway,
    {
      role: 'builder',
      system: AI_SYSTEM_PROMPT,
      user: `${config.instructions as string}\n\nText to read:\n${input.text as string}`,
      schema,
      schemaName: 'ai_extract',
    },
    'read',
  );
  return {
    output: result.data.output,
    why: result.data.why,
    model: result.model,
    tokens: result.tokens,
    costUsd: result.costUsd,
  };
};

export const writeExecutor: Executor = async (config, input, ctx) => {
  // ctx.signal: see extractExecutor (accepted, not acted on in M1).
  const schema = z.object({ output: z.object({ text: z.string() }), why: z.string() });
  const result = await chatJsonWithSchemaRetry(
    ctx.gateway,
    {
      role: 'builder',
      system: AI_SYSTEM_PROMPT,
      user: `${config.instructions as string}\n\nTone: ${config.tone as string}\n\nContext:\n${JSON.stringify(input.context)}`,
      schema,
      schemaName: 'ai_write',
    },
    'write',
  );
  return {
    output: result.data.output,
    why: result.data.why,
    model: result.model,
    tokens: result.tokens,
    costUsd: result.costUsd,
  };
};
