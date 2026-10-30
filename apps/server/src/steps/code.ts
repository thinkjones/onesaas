import vm from 'node:vm';
import { z } from 'zod';
import type { ColumnType } from '@dad/shared';
import { fieldSchema } from './ai.js';
import type { Executor } from './registry.js';

/** The calculation ran past the vm timeout (an infinite loop or worse). */
export const CODE_TOO_LONG = 'This calculation took too long.';

/**
 * The calculation reached for something outside its sandbox (require,
 * process, fetch, …): those names are undefined in the context, so the read
 * throws a ReferenceError (or EvalError) from inside the vm.
 */
export const CODE_NOT_ALLOWED = "This calculation tried to use something it isn't allowed to.";

interface OutputField {
  name: string;
  type: ColumnType;
}

/**
 * The escape step: runs the agent-written `code` (the body of
 * `(input) => output`) in a `node:vm` sandbox whose context holds ONLY the
 * deep-cloned input plus Math/Date/JSON/String/Number/Array/Object —
 * direct reads of require/process/fetch throw, and string/wasm code
 * generation is disabled — with a 250 ms timeout. Honest scope: this guards
 * against buggy agent-written calculations, not malicious code (the host
 * constructor chain stays reachable through the passed-in objects, so
 * node:vm is not a security boundary here). The output is validated against a
 * zod object built at run time from `outputFields`; the why is the config's
 * `explanation`, one plain sentence the agent wrote for Dad.
 */
export const codeTransformExecutor: Executor = async (config, input) => {
  const code = config.code as string;
  const explanation = config.explanation as string;
  const outputFields = config.outputFields as OutputField[];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of outputFields) {
    if (field.name in shape) throw new Error(`Duplicate field: "${field.name}"`);
    shape[field.name] = fieldSchema(field.type);
  }
  const schema = z.object(shape);
  // Deep-cloned so the calculation can neither see nor mutate the live input.
  const sandbox = {
    input: structuredClone(input),
    Math,
    Date,
    JSON,
    String,
    Number,
    Array,
    Object,
  };
  let result: unknown;
  try {
    result = vm.runInNewContext(`(function(input){ ${code} })(input)`, sandbox, {
      timeout: 250,
      // The spec's `codeGeneration: { strings: false, wasm: false }`, spelled
      // the way runInNewContext takes it: the bare `codeGeneration` key is
      // silently ignored here (verified at runtime), only
      // `contextCodeGeneration` disables eval/Function and wasm compilation.
      contextCodeGeneration: { strings: false, wasm: false },
    });
  } catch (err) {
    // Cross-realm errors: instanceof is FALSE for vm-thrown errors (their
    // prototypes live in the vm realm), so match on duck-typed name/message.
    const probe = err as { name?: unknown; message?: unknown } | null;
    const name = typeof probe?.name === 'string' ? probe.name : '';
    const message = typeof probe?.message === 'string' ? probe.message : String(err);
    if (/timed out/.test(message)) throw new Error(CODE_TOO_LONG);
    if (name === 'ReferenceError' || name === 'EvalError') throw new Error(CODE_NOT_ALLOWED);
    throw err;
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `"${issue.path.join('.') || '(result)'}" ${issue.message.toLowerCase()}`)
      .join('; ');
    throw new Error(`This calculation didn't return what was expected: ${detail}.`);
  }
  return { output: parsed.data, why: explanation };
};
