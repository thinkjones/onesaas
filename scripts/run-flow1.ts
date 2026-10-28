// Manual-inspection tool (NOT a test gate): boots the real server composition
// root and runs flow 1 once with a canned email payload, printing the run and
// per-step status/why/error. Exit code is ALWAYS 0 — read the output.
// Uses the DEFAULT db (data/app.db relative to CWD — the real dev DB).
import { createServer } from '../apps/server/src/main.js';

const payload = {
  email: {
    from: 'sarah@example.com',
    fromName: 'Sarah Lee',
    subject: 'Quote for a new fence',
    body: "Hi, I'm Sarah Lee, I'd like a quote for a new fence. Can you call me this week?",
    threadId: 'canned-thread-1',
  },
};

async function main(): Promise<void> {
  const { engine, repo } = createServer();
  let runId: string | null = null;
  try {
    const run = await engine.start('flow-1', payload);
    runId = run.id;
  } catch (e: unknown) {
    console.log(`start rejected (infra failure): ${e instanceof Error ? e.message : String(e)}`);
  }

  if (runId) {
    const got = repo.getRun(runId);
    if (!got) {
      console.log(`run ${runId}: missing from repo`);
    } else {
      console.log(`run ${got.run.id} ${got.run.workflowId}: ${got.run.status}`);
      for (const s of got.steps) {
        const extra =
          s.status === 'failed' && s.error
            ? ` — ${s.error}`
            : s.why
              ? ` — ${s.why}`
              : '';
        console.log(`  ${s.stepId}: ${s.status}${extra}`);
      }
    }
  }
}

// No top-level await: the root package is CJS, so tsx compiles this as CJS.
void main();
