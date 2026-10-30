import type { Executor } from './registry.js';

// MUST match the catalog's configSchema default: the engine validates schemas
// as guards only, so zod .default() never applies at runtime and the executor
// applies it manually here instead.
export const DEFAULT_APPROVAL_QUESTION = 'Is this OK to use?';

export const askExecutor: Executor = async (config, input, _ctx) => {
  const question = (config as { question?: string }).question ?? DEFAULT_APPROVAL_QUESTION;
  const text = (input as { text: string }).text;
  // The interim why is overwritten when the run is resolved; the output is
  // provisional { proposed } (not the final schema), so the engine skips
  // output validation for waiting steps.
  return {
    output: { proposed: { text } },
    why: 'Waiting for you to approve this.',
    wait: { kind: 'approval', question, proposed: { text } },
  };
};

// Test-mode preview: auto-approves (no `wait`), so downstream steps run and
// the test finishes with every step done instead of parking on approval.
askExecutor.preview = async (_config, input, _ctx) => {
  const text = (input as { text: string }).text;
  return {
    output: { text, decision: 'approved' },
    why: "In a real run I'd ask you to check this first.",
  };
};
