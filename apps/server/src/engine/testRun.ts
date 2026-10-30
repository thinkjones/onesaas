import { catalog, emailSchema, type Run, type StepRun } from '@dad/shared';
import type { Repo } from '../db/repo.js';
import type { Executor, StepContext } from '../steps/registry.js';
import { createEngine } from './engine.js';

// How long a test run waits for Gmail's open email before falling back to
// the catalog sample. Also passed to the bridge so a connected-but-slow
// extension releases its pending call at the same deadline.
const SAMPLE_TIMEOUT_MS = 5000;

export interface TestRunResult {
  run: Run;
  steps: StepRun[];
  /**
   * True IFF an email trigger (gmailButton/email) fell back to the catalog
   * sample INSTEAD of a live open email. Manual/other triggers always run on
   * their sample but report false: the story prefix is email-specific, so it
   * must only appear for an email trigger that missed its live email.
   */
  usedSample: boolean;
}

// Samples live on the shared catalog object: clone so a run can never mutate
// the module-level original through its trigger payload or bindings.
function cloneSample(sample: unknown): unknown {
  return sample === undefined ? undefined : JSON.parse(JSON.stringify(sample));
}

// Fail fast when the trigger type has no sample (unknown type, or a catalog
// entry without one): otherwise the run dies later as a cryptic per-step
// Zod failure ("expected object, received undefined").
function sampleFor(triggerType: string): unknown {
  const sample = catalog[triggerType]?.sample;
  if (sample === undefined) throw new Error(`No sample for trigger type: ${triggerType}`);
  return cloneSample(sample);
}

/**
 * The canvas "Try it" runner: executes the real engine with `testMode` on,
 * so every outside-world action becomes a preview (act/store executors run
 * their `preview`, approval.ask auto-approves) and the run is saved with
 * kind 'test' (hidden from history unless explicitly listed).
 *
 * The trigger payload is the email open in Gmail when one can be read, else
 * the trigger's catalog sample (non-email triggers always use the sample,
 * but still report usedSample=false — see TestRunResult).
 */
export function createTestRunner(d: {
  repo: Repo;
  executors: Record<string, Executor>;
  ctx: Omit<StepContext, 'signal'>;
}): { testRun: (workflowId: string) => Promise<TestRunResult> } {
  const { repo, executors, ctx } = d;
  const engine = createEngine({ repo, executors, ctx: { ...ctx, testMode: true } });

  // The one bridge touch a test run makes. Disconnected, timed-out,
  // rejected, and malformed-email ALL mean "no open email": the caller
  // falls back to the sample. Never throws.
  async function readLiveEmail(): Promise<Record<string, unknown> | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for the open email.')),
          SAMPLE_TIMEOUT_MS,
        );
      });
      const raw = await Promise.race([
        ctx.bridge.call('gmail', 'readOpenEmail', {}, SAMPLE_TIMEOUT_MS),
        timeout,
      ]);
      const parsed = emailSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function testRun(workflowId: string): Promise<TestRunResult> {
    const wf = repo.getWorkflow(workflowId);
    if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
    let triggerPayload: unknown;
    let usedSample: boolean;
    if (wf.trigger.type === 'trigger.gmailButton' || wf.trigger.type === 'trigger.email') {
      const email = await readLiveEmail();
      if (email === undefined) {
        triggerPayload = sampleFor(wf.trigger.type);
        usedSample = true;
      } else {
        triggerPayload = { email };
        usedSample = false;
      }
    } else {
      triggerPayload = sampleFor(wf.trigger.type);
      usedSample = false;
    }
    const run = await engine.start(workflowId, triggerPayload, { kind: 'test' });
    const full = repo.getRun(run.id);
    if (!full) throw new Error(`Test run vanished: ${run.id}`);
    return { run: full.run, steps: full.steps, usedSample };
  }

  return { testRun };
}
