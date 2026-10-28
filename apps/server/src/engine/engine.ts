import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  catalog,
  evalCondition,
  resolveBindings,
  topoOrder,
  type Edge,
  type Run,
  type StepInstance,
  type StepRun,
  type StepRunStatus,
} from '@dad/shared';
import type { Repo } from '../db/repo.js';
import type { Executor, StepContext } from '../steps/registry.js';
import type { EngineEvent } from './events.js';

export type ApprovalDecision =
  | { action: 'approve' }
  | { action: 'edit'; text: string }
  | { action: 'skip' };

export function createEngine(d: {
  repo: Repo;
  executors: Record<string, Executor>;
  ctx: Omit<StepContext, 'signal'>;
}): {
  start: (workflowId: string, triggerPayload: unknown) => Promise<Run>;
  resolveApproval: (runId: string, stepId: string, d: ApprovalDecision) => Promise<Run>;
  retryStep: (runId: string, stepId: string) => Promise<Run>;
  resumeAll: () => Promise<void>;
  events: EventEmitter;
} {
  const { repo, executors, ctx: ctxBase } = d;
  const events = new EventEmitter();
  events.setMaxListeners(0); // Singleton engine + per-connection SSE subscribers (Task 9): never warn.
  // Per-run continueRun tails: resolving an approval while a sibling wave is
  // still in flight must not start a second loop on the same run (the
  // resolving pass would load in-flight `running` rows as ready and RE-RUN
  // them, then finalize from a stale status map). Engine-instance scope, not
  // module scope: createEngine runs per boot and per test, and a module-level
  // map would leak tails across tests.
  const tails = new Map<string, Promise<unknown>>();

  function emit(e: EngineEvent): void {
    // A listener must never break a run: one throwing subscriber (e.g. SSE in
    // Task 9) would otherwise propagate out of runStep → reject Promise.all →
    // reject start() with the run stuck `running` forever.
    try {
      events.emit('event', e);
    } catch {
      // Deliberately swallowed: listener errors are not run errors.
    }
  }

  // The shared run loop: start, resolveApproval, retryStep (Task 2) and
  // resumeAll all drive runs through this. Loads the run plus its PINNED
  // workflow version (getWorkflow with the run's own version, so a retry
  // after an edit still runs the version the run started on), re-enters
  // non-running runs as `running`, rebuilds the binding context ONLY from
  // `done` StepRuns (trigger output + stepId→output), then runs M1's wave
  // loop unchanged. Waiting steps park the loop: `waiting` is terminal for
  // the wave loop (never re-run) but blocks the ready rule (neither done
  // nor skipped), so dependents keep their pending rows.
  //
  // Serialized per run id via a promise-chain mutex: a pass that arrives
  // while another is in flight (resolve-during-wave) waits for the earlier
  // pass to settle, then reloads fresh state. Deadlock-free: no caller nests
  // continueRun. Only the CHAIN is guarded (prev.catch): the pass itself
  // rejects to its own awaiter, and the finally-cleanup only deletes its own
  // tail so a newer waiter is never unlinked.
  async function continueRun(runId: string): Promise<Run> {
    const prev = tails.get(runId) ?? Promise.resolve();
    const cur = prev.catch(() => {}).then(() => doContinueRun(runId));
    tails.set(runId, cur);
    try {
      return await cur;
    } finally {
      if (tails.get(runId) === cur) tails.delete(runId);
    }
  }
  async function doContinueRun(runId: string): Promise<Run> {
    const loaded = repo.getRun(runId);
    if (!loaded) throw new Error(`Unknown run: ${runId}`);
    let run = loaded.run;
    const wf = repo.getWorkflow(run.workflowId, run.workflowVersion);
    if (!wf) throw new Error(`Unknown workflow: ${run.workflowId}`);
    // Bound const: narrowing on `wf` does not survive into the runStep closure.
    const workflow = wf;
    const order = topoOrder(workflow);
    const byId = new Map<string, StepInstance>([[workflow.trigger.id, workflow.trigger]]);
    for (const s of workflow.steps) byId.set(s.id, s);
    const incoming = new Map<string, Edge[]>(order.map((id) => [id, []]));
    for (const e of workflow.edges) incoming.get(e.to)!.push(e);
    const savedById = new Map<string, StepRun>(loaded.steps.map((s) => [s.stepId, s]));

    // Every repo write below (the running re-entry, runStep upserts, the
    // final updateRun) can throw on infra failure; the catch best-efforts a
    // failed-mark so the run never sticks `running` with no terminal event.
    try {
      // Re-entry: resolve/resume paths arrive as waiting/running and emit a
      // `running` event; the start path is already running, so no double-emit.
      if (run.status !== 'running') {
        repo.updateRun(run.id, { status: 'running' });
        run = repo.getRun(run.id)!.run;
        emit({ type: 'run', run });
      }

      // Defensive: every M1+ run pre-creates full graph coverage, but a
      // crafted or cross-version row set may miss steps; continueRun is
      // self-sufficient rather than crashing on the lookup below.
      for (const id of order) {
        if (!savedById.has(id)) {
          const pending: StepRun = {
            id: randomUUID(),
            runId: run.id,
            stepId: id,
            status: 'pending',
            startedAt: new Date().toISOString(),
          };
          repo.upsertStepRun(pending);
          savedById.set(id, pending);
          emit({ type: 'step', stepRun: pending });
        }
      }

      // One controller per continueRun call; nothing aborts in M1 (M2's cancellation hook).
      const signal = new AbortController().signal;
      const stepRunIds = new Map<string, string>(order.map((id) => [id, savedById.get(id)!.id]));
      const statusOf = new Map<string, StepRunStatus>(
        order.map((id) => [id, savedById.get(id)!.status]),
      );
      // Binding context: trigger output under `trigger` plus every finished
      // step's output under its step id (trigger also under its own id when it
      // differs from 'trigger'). Only `done` outputs: waiting/skipped/failed
      // steps contribute nothing, so a resumed run sees exactly what the
      // original run saw.
      const bindings: Record<string, unknown> = {};
      for (const [stepId, sr] of savedById) {
        if (sr.status === 'done') {
          bindings[stepId] = sr.output;
          if (stepId === workflow.trigger.id) bindings['trigger'] = sr.output;
        }
      }

      const isTerminal = (s: StepRunStatus): boolean =>
        s === 'done' || s === 'skipped' || s === 'failed' || s === 'waiting';

      // One step's unit of work: skip or run to a terminal state.
      // Executor/schema failures never reject (they fail the step so other
      // branches continue); infra failures reject after a best-effort
      // failed-mark by the finalizer below.
      async function runStep(stepId: string): Promise<void> {
        const step = byId.get(stepId)!;
        const def = catalog[step.type]!;
        const executor = executors[step.type]!;
        const srId = stepRunIds.get(stepId)!;
        const startedAt = savedById.get(stepId)!.startedAt;
        const inc = incoming.get(stepId)!;

        // OR-join: satisfied when from a done step with a true/absent `when`.
        // Every incoming `when` is evaluated (workflow.edges order) even from
        // skipped sources, so the first false one names the skip reason.
        let satisfied = false;
        const falseWhens: string[] = [];
        for (const e of inc) {
          let condTrue = true;
          if (e.when !== undefined) {
            condTrue = await evalCondition(e.when, bindings);
            if (!condTrue) falseWhens.push(e.when);
          }
          if (statusOf.get(e.from) === 'done' && condTrue) satisfied = true;
        }
        if (inc.length > 0 && !satisfied) {
          const why =
            falseWhens.length > 0
              ? `Skipped because the condition "${falseWhens[0]}" was not met.`
              : 'Skipped because an earlier step was skipped.';
          const skipped: StepRun = {
            id: srId,
            runId: run.id,
            stepId,
            status: 'skipped',
            why,
            startedAt,
          };
          repo.upsertStepRun(skipped);
          statusOf.set(stepId, 'skipped');
          emit({ type: 'step', stepRun: skipped });
          return;
        }

        const timerStarted = Date.now();
        const running: StepRun = {
          id: srId,
          runId: run.id,
          stepId,
          status: 'running',
          startedAt,
        };
        repo.upsertStepRun(running);
        statusOf.set(stepId, 'running');
        emit({ type: 'step', stepRun: running });

        let input: unknown;
        try {
          // The single choke point: config validated (converts cryptic executor
          // TypeErrors into clean step failures), then inputs resolved, then
          // input validated. Schemas are guards only — originals flow through
          // (zod strip would gut trigger echo: manual's inputSchema {} would
          // strip { payload } to {} and break the output check downstream).
          def.configSchema.parse(step.config);
          input =
            stepId === workflow.trigger.id
              ? run.triggerPayload
              : await resolveBindings(step.inputs, bindings);
          def.inputSchema.parse(input);
          const result = await executor(step.config, input, { ...ctxBase, signal });
          // A waiting result parks the step: output validation is SKIPPED
          // because the output is provisional ({ proposed }, not the final
          // schema — the final output is written by resolveApproval). The
          // question lives in the step config, so only the proposal is
          // stored. Bindings are untouched: dependents block on `waiting`
          // via the unchanged ready rule below.
          if (result.wait?.kind === 'approval') {
            const waiting: StepRun = {
              id: srId,
              runId: run.id,
              stepId,
              status: 'waiting',
              input,
              output: { proposed: result.wait.proposed },
              why: result.why ?? 'Finished.',
              model: result.model,
              tokens: result.tokens,
              costUsd: result.costUsd,
              durationMs: Date.now() - timerStarted,
              startedAt,
            };
            repo.upsertStepRun(waiting);
            statusOf.set(stepId, 'waiting');
            emit({ type: 'step', stepRun: waiting });
            return;
          }
          def.outputSchema.parse(result.output);
          const done: StepRun = {
            id: srId,
            runId: run.id,
            stepId,
            status: 'done',
            input,
            output: result.output,
            why: result.why ?? 'Finished.',
            model: result.model,
            tokens: result.tokens,
            costUsd: result.costUsd,
            durationMs: Date.now() - timerStarted,
            startedAt,
          };
          repo.upsertStepRun(done);
          statusOf.set(stepId, 'done');
          emit({ type: 'step', stepRun: done });
          bindings[stepId] = result.output;
          if (stepId === workflow.trigger.id) bindings['trigger'] = result.output;
        } catch (err) {
          const failed: StepRun = {
            id: srId,
            runId: run.id,
            stepId,
            status: 'failed',
            ...(input !== undefined ? { input } : {}),
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - timerStarted,
            startedAt,
          };
          repo.upsertStepRun(failed);
          statusOf.set(stepId, 'failed');
          emit({ type: 'step', stepRun: failed });
        }
      }

      // Wave loop: a step is ready when every incoming edge comes from a
      // done/skipped step. Dependents of a failed or waiting step never
      // become ready and keep their pending rows. Each wave moves every ready
      // step to a terminal state, so the loop always terminates.
      for (;;) {
        const ready = order.filter((id) => {
          if (isTerminal(statusOf.get(id)!)) return false;
          return incoming
            .get(id)!
            .every((e) => statusOf.get(e.from) === 'done' || statusOf.get(e.from) === 'skipped');
        });
        if (ready.length === 0) break;
        await Promise.all(ready.map((id) => runStep(id)));
      }

      // Cost passthrough: executors omit model/tokens/costUsd when they have no
      // model cost; undefined is stored as-is and never synthesized to 0/NaN
      // (M2 aggregates with `?? 0`).
      const values = [...statusOf.values()];
      const status = values.some((s) => s === 'failed')
        ? 'failed'
        : values.some((s) => s === 'waiting')
          ? 'waiting'
          : 'done';
      // endedAt marks a terminal run only: a waiting run is paused, not over,
      // so it carries no endedAt (and updateRun cannot unset, so none is set).
      repo.updateRun(
        run.id,
        status === 'waiting' ? { status } : { status, endedAt: new Date().toISOString() },
      );
      run = repo.getRun(run.id)!.run;
      emit({ type: 'run', run });
      return run;
    } catch (err) {
      // Best-effort finalizer: mark the run failed so it never sticks
      // `running`, emit the terminal run event (emit itself is guarded), then
      // rethrow — infra failures reject.
      const endedAt = new Date().toISOString();
      try {
        repo.updateRun(run.id, { status: 'failed', endedAt });
      } catch {
        // The store itself is failing: nothing left to do.
      }
      run = { ...run, status: 'failed', endedAt };
      emit({ type: 'run', run });
      throw err;
    }
  }

  async function start(workflowId: string, triggerPayload: unknown): Promise<Run> {
    const wf = repo.getWorkflow(workflowId);
    if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
    // Pre-flight before any run row exists: invalid workflows never run.
    const order = topoOrder(wf);
    const byId = new Map<string, StepInstance>([[wf.trigger.id, wf.trigger]]);
    for (const s of wf.steps) byId.set(s.id, s);
    for (const id of order) {
      const type = byId.get(id)!.type;
      if (!catalog[type] || !executors[type]) throw new Error(`Unknown step type: ${type}`);
    }

    const run = repo.createRun({
      workflowId,
      workflowVersion: wf.version,
      triggerPayload,
      status: 'running',
    });
    emit({ type: 'run', run });

    // Pre-create failures finalize here; everything after is continueRun's
    // (which owns its own finalizer), so a failure is never marked twice.
    try {
      // Pre-create every StepRun as pending, in topo order (insertion order, so
      // getRun returns full graph coverage from run start for M2's canvas).
      // Trade-off: startedAt is ~run start for all steps (upsert preserves the
      // first write), not the moment each step actually starts.
      const preCreatedAt = new Date().toISOString();
      for (const id of order) {
        const pending: StepRun = {
          id: randomUUID(),
          runId: run.id,
          stepId: id,
          status: 'pending',
          startedAt: preCreatedAt,
        };
        repo.upsertStepRun(pending);
        emit({ type: 'step', stepRun: pending });
      }
    } catch (err) {
      const endedAt = new Date().toISOString();
      try {
        repo.updateRun(run.id, { status: 'failed', endedAt });
      } catch {
        // The store itself is failing: nothing left to do.
      }
      emit({ type: 'run', run: { ...run, status: 'failed', endedAt } });
      throw err;
    }
    return continueRun(run.id);
  }

  function approvalTime(): string {
    // Server-local wall clock ("9:42 AM"). There is no stored timezone yet —
    // that is an M5 setting; until then the server's locale is the contract.
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  }

  async function resolveApproval(runId: string, stepId: string, d: ApprovalDecision): Promise<Run> {
    const loaded = repo.getRun(runId);
    const sr = loaded?.steps.find((s) => s.stepId === stepId);
    // Covers double-resolve too: the second call sees done/skipped, not waiting.
    if (!sr || sr.status !== 'waiting') throw new Error("That step isn't waiting for you.");
    // Engine-written data, so this shape is trusted; the fallback is purely
    // defensive against malformed rows.
    const proposed = ((sr.output as { proposed?: unknown } | undefined)?.proposed ?? {}) as {
      text?: unknown;
    };
    const proposedText = typeof proposed.text === 'string' ? proposed.text : '';
    if (d.action === 'skip') {
      // Output is LEFT as-is (the provisional { proposed }) for audit;
      // downstream steps skip via M1's OR-join rule, no new code.
      const skipped: StepRun = {
        id: sr.id,
        runId,
        stepId,
        status: 'skipped',
        input: sr.input,
        output: sr.output,
        why: 'You chose to skip this.',
        startedAt: sr.startedAt,
      };
      repo.upsertStepRun(skipped);
      emit({ type: 'step', stepRun: skipped });
    } else {
      const text = d.action === 'edit' ? d.text : proposedText;
      const done: StepRun = {
        id: sr.id,
        runId,
        stepId,
        status: 'done',
        input: sr.input,
        output: { text, decision: d.action === 'edit' ? 'edited' : 'approved' },
        why:
          d.action === 'edit'
            ? `You changed the wording and approved it at ${approvalTime()}.`
            : `You approved this at ${approvalTime()}.`,
        model: sr.model,
        tokens: sr.tokens,
        costUsd: sr.costUsd,
        durationMs: sr.durationMs,
        startedAt: sr.startedAt,
      };
      repo.upsertStepRun(done);
      emit({ type: 'step', stepRun: done });
    }
    // Multi-approval flows work: if a later step waits, this pass ends
    // `waiting` again and the run pauses there.
    return continueRun(runId);
  }

  // Re-runs one failed step, then continues the run. Failed steps only: any
  // other state (pending, running, waiting, done, skipped) — and unknown
  // run/step ids — reject with the same message, mirroring resolveApproval;
  // the routes discriminate 404 from 409 with their own lookups. The step is
  // reset to fresh `pending` (same id/runId/stepId/startedAt) and continueRun
  // re-resolves its inputs from the saved `done` outputs under the run's OWN
  // pinned workflow version, so a retry after an edit still runs the version
  // the run started on. NO downstream reset: the wave ready rule only admits
  // steps whose incoming edges are all done/skipped, so everything downstream
  // of a failed step is still `pending` and runs naturally in this pass.
  async function retryStep(runId: string, stepId: string): Promise<Run> {
    const loaded = repo.getRun(runId);
    const sr = loaded?.steps.find((s) => s.stepId === stepId);
    if (!sr || sr.status !== 'failed') {
      throw new Error('Only a step that needs a look can be retried.');
    }
    const pending: StepRun = {
      id: sr.id,
      runId,
      stepId,
      status: 'pending',
      startedAt: sr.startedAt,
    };
    repo.upsertStepRun(pending);
    emit({ type: 'step', stepRun: pending });
    return continueRun(runId);
  }

  // Boot recovery, called once at boot. Waiting runs are left alone entirely
  // (no-op by design: they must stay waiting AND resolvable). Running runs
  // are triaged by the KIND of each interrupted (`running`) step: `act`
  // steps may have side-effected, so they NEVER auto-re-run — they fail with
  // a retry hint and the run fails without launching anything new. Non-act
  // steps are side-effect-free, so they reset to fresh `pending` and the run
  // continues. An unknown kind fails safe (treated as act). A running run
  // with no running steps (crash between waves) just continues; the end rule
  // settles it. Runs are processed in listRuns order (newest-first); runs are
  // independent so the order is irrelevant. NOTE: listRuns loads every run;
  // fine for a single household's history, revisit with pagination if the
  // runs table ever grows unbounded. Boot-only contract: no live run shares
  // the repo while this runs, so no locking against concurrent writers.
  async function resumeAll(): Promise<void> {
    const runs = repo.listRuns();
    for (const r of runs) {
      if (r.status !== 'running' && r.status !== 'waiting') continue;
      if (r.status === 'waiting') continue;
      // One poison run (e.g. a corrupted def that throws out of continueRun)
      // must not abort the loop: boot runs once with no retry, so a throw
      // here would strand every healthy run after it as `running` forever.
      try {
        await resumeOneRunning(r.id);
      } catch (err) {
        console.warn(
          `resumeAll: skipping run ${r.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async function resumeOneRunning(runId: string): Promise<void> {
    const loaded = repo.getRun(runId);
    const r = loaded?.run;
    const wf = r ? repo.getWorkflow(r.workflowId, r.workflowVersion) : undefined;
    if (!loaded || !r || !wf) return;
    const kindById = new Map<string, string>([
      [wf.trigger.id, catalog[wf.trigger.type]?.kind ?? ''],
    ]);
    for (const s of wf.steps) kindById.set(s.id, catalog[s.type]?.kind ?? '');
    // Only these kinds are provably side-effect-free; anything else (act,
    // unknown types, cross-version drift) fails safe as act below.
    const rerunnable = new Set(['trigger', 'fetch', 'enrich', 'store']);
    let sawAct = false;
    for (const sr of loaded.steps) {
      if (sr.status !== 'running') continue;
      const kind = kindById.get(sr.stepId);
      if (!kind || !rerunnable.has(kind)) {
        sawAct = true;
        // The attempt never finished, so durationMs stays undefined; the
        // input is kept for the retry hint's context.
        const failed: StepRun = {
          id: sr.id,
          runId: r.id,
          stepId: sr.stepId,
          status: 'failed',
          input: sr.input,
          error: "I was interrupted while doing this. Press Retry if it didn't happen.",
          startedAt: sr.startedAt,
        };
        repo.upsertStepRun(failed);
        emit({ type: 'step', stepRun: failed });
      } else {
        // Fresh pending: same id/runId/stepId/startedAt, everything else
        // cleared (upsert replaces all mutable fields).
        const pending: StepRun = {
          id: sr.id,
          runId: r.id,
          stepId: sr.stepId,
          status: 'pending',
          startedAt: sr.startedAt,
        };
        repo.upsertStepRun(pending);
        emit({ type: 'step', stepRun: pending });
      }
    }
    if (sawAct) {
      // Failed runs launch nothing new: other pendings stay pending.
      repo.updateRun(r.id, { status: 'failed', endedAt: new Date().toISOString() });
      emit({ type: 'run', run: repo.getRun(r.id)!.run });
      return;
    }
    await continueRun(runId);
  }

  return { start, resolveApproval, retryStep, resumeAll, events };
}
