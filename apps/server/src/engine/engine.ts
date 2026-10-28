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

export function createEngine(d: {
  repo: Repo;
  executors: Record<string, Executor>;
  ctx: Omit<StepContext, 'signal'>;
}): {
  start: (workflowId: string, triggerPayload: unknown) => Promise<Run>;
  events: EventEmitter;
} {
  const { repo, executors, ctx: ctxBase } = d;
  const events = new EventEmitter();

  function emit(e: EngineEvent): void {
    events.emit('event', e);
  }

  async function start(workflowId: string, triggerPayload: unknown): Promise<Run> {
    const wf = repo.getWorkflow(workflowId);
    if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
    // Bound const: narrowing on `wf` does not survive into the runStep closure.
    const workflow = wf;
    // Pre-flight before any run row exists: invalid workflows never run.
    const order = topoOrder(wf);
    const byId = new Map<string, StepInstance>([[wf.trigger.id, wf.trigger]]);
    for (const s of wf.steps) byId.set(s.id, s);
    for (const id of order) {
      const type = byId.get(id)!.type;
      if (!catalog[type] || !executors[type]) throw new Error(`Unknown step type: ${type}`);
    }
    const incoming = new Map<string, Edge[]>(order.map((id) => [id, []]));
    for (const e of wf.edges) incoming.get(e.to)!.push(e);

    let run = repo.createRun({
      workflowId,
      workflowVersion: wf.version,
      triggerPayload,
      status: 'running',
    });
    emit({ type: 'run', run });

    // Pre-create every StepRun as pending, in topo order (insertion order, so
    // getRun returns full graph coverage from run start for M2's canvas).
    // Trade-off: startedAt is ~run start for all steps (upsert preserves the
    // first write), not the moment each step actually starts.
    const preCreatedAt = new Date().toISOString();
    const stepRunIds = new Map<string, string>();
    for (const id of order) {
      const pending: StepRun = {
        id: randomUUID(),
        runId: run.id,
        stepId: id,
        status: 'pending',
        startedAt: preCreatedAt,
      };
      repo.upsertStepRun(pending);
      stepRunIds.set(id, pending.id);
      emit({ type: 'step', stepRun: pending });
    }

    // One controller per run; nothing aborts in M1 (M2's cancellation hook).
    const signal = new AbortController().signal;
    const statusOf = new Map<string, StepRunStatus>(order.map((id) => [id, 'pending']));
    // Binding context: trigger output under `trigger` plus every finished
    // step's output under its step id (trigger also under its own id when it
    // differs from 'trigger').
    const bindings: Record<string, unknown> = {};

    const isTerminal = (s: StepRunStatus): boolean =>
      s === 'done' || s === 'skipped' || s === 'failed';

    // One step's unit of work: skip or run to a terminal state. Never rejects:
    // every failure is captured as a failed StepRun so other branches continue.
    async function runStep(stepId: string): Promise<void> {
      const step = byId.get(stepId)!;
      const def = catalog[step.type]!;
      const executor = executors[step.type]!;
      const srId = stepRunIds.get(stepId)!;
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
          startedAt: preCreatedAt,
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
        startedAt: preCreatedAt,
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
            ? triggerPayload
            : await resolveBindings(step.inputs, bindings);
        def.inputSchema.parse(input);
        const result = await executor(step.config, input, { ...ctxBase, signal });
        def.outputSchema.parse(result.output);
        const done: StepRun = {
          id: srId,
          runId: run.id,
          stepId,
          status: 'done',
          input,
          output: result.output,
          why: result.why,
          model: result.model,
          tokens: result.tokens,
          costUsd: result.costUsd,
          durationMs: Date.now() - timerStarted,
          startedAt: preCreatedAt,
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
          startedAt: preCreatedAt,
        };
        repo.upsertStepRun(failed);
        statusOf.set(stepId, 'failed');
        emit({ type: 'step', stepRun: failed });
      }
    }

    // Wave loop: a step is ready when every incoming edge comes from a
    // done/skipped step. Dependents of a failed step never become ready and
    // keep their pending rows. Each wave moves every ready step to a terminal
    // state, so the loop always terminates.
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
    const status = [...statusOf.values()].some((s) => s === 'failed') ? 'failed' : 'done';
    repo.updateRun(run.id, { status, endedAt: new Date().toISOString() });
    run = repo.getRun(run.id)!.run;
    emit({ type: 'run', run });
    return run;
  }

  return { start, events };
}
