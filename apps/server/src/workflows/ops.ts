import {
  Workflow,
  topoOrder,
  type StepDef,
  type StepInstance,
  type Workflow as WorkflowType,
} from '@dad/shared';
import { nanoid } from 'nanoid';
import type { Repo } from '../db/repo.js';
import type { TableStore } from '../tables/store.js';
import { checkWorkflow, extractRefs, upstreamIds } from './validate.js';

export type OpResult = { ok: true; workflow: WorkflowType; note: string } | { ok: false; error: string };

export type OpBy = 'dad' | 'agent';

export interface OpOpts {
  /** Who made the change. Direct calls default to the agent; the web passes 'dad'. */
  by?: OpBy;
}

export interface WorkflowOps {
  create(o: { name: string; description: string }): WorkflowType;
  setTrigger(
    id: string,
    o: { type: string; config: Record<string, unknown>; title?: string; summary?: string },
    opts?: OpOpts,
  ): OpResult;
  addStep(
    id: string,
    o: {
      type: string;
      title: string;
      summary: string;
      config: Record<string, unknown>;
      inputs: Record<string, string>;
      after?: string;
    },
    opts?: OpOpts,
  ): OpResult;
  updateStep(
    id: string,
    stepId: string,
    patch: Partial<Pick<StepInstance, 'title' | 'summary' | 'config' | 'inputs'>>,
    opts?: OpOpts,
  ): OpResult;
  removeStep(id: string, stepId: string, opts?: OpOpts): OpResult;
  connect(id: string, o: { from: string; to: string; when?: string }, opts?: OpOpts): OpResult;
  disconnect(id: string, o: { from: string; to: string }, opts?: OpOpts): OpResult;
  move(id: string, stepId: string, position: { x: number; y: number }, opts?: OpOpts): OpResult;
  setStatus(id: string, status: 'on' | 'off', opts?: OpOpts): OpResult;
  rename(id: string, o: { name: string; description?: string }, opts?: OpOpts): OpResult;
}

export function createWorkflowOps(d: {
  repo: Repo;
  tables: TableStore;
  catalog: Record<string, StepDef>;
  onChange?: (wf: WorkflowType, note: string, by: 'dad' | 'agent') => void;
}): WorkflowOps {
  const { repo, tables, catalog } = d;

  function titleOf(wf: WorkflowType, stepId: string): string {
    if (wf.trigger.id === stepId) return wf.trigger.title;
    return wf.steps.find((s) => s.id === stepId)?.title ?? stepId;
  }

  function hasStep(wf: WorkflowType, stepId: string): boolean {
    return wf.trigger.id === stepId || wf.steps.some((s) => s.id === stepId);
  }

  // Every successful op except create notifies with its note. Versioned ops
  // save through saveWorkflow (which dedupes true no-ops); move is the only
  // op that rewrites the latest version in place.
  function done(note: string, wf: WorkflowType, by: OpBy, inPlace: boolean): OpResult {
    const parsed = Workflow.safeParse(wf);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid workflow change' };
    }
    const saved = inPlace ? repo.updateLatestInPlace(parsed.data) : repo.saveWorkflow(parsed.data);
    d.onChange?.(saved, note, by);
    return { ok: true, workflow: saved, note };
  }

  // A binding is valid exactly when its step is upstream of the reader.
  // Anything else — a typo, a downstream step, a removed step — is refused.
  // When `exists` is given, a step that is gone entirely gets checkWorkflow's
  // "removed step" message; otherwise the single "isn't before it" message
  // names the binding as written.
  function badBinding(
    refs: ReturnType<typeof extractRefs>,
    upstream: Set<string>,
    exists?: (stepId: string) => boolean,
  ): OpResult | undefined {
    for (const { ref, stepId } of refs) {
      if (!upstream.has(stepId)) {
        if (exists && !exists(stepId)) {
          return { ok: false, error: 'Needs an input from a removed step.' };
        }
        return {
          ok: false,
          error: `Needs an input from a step that isn't before it ("${ref}").`,
        };
      }
    }
    return undefined;
  }

  function slug(title: string): string {
    const s = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s.length > 0 ? s : 'step';
  }

  return {
    create(o: { name: string; description: string }): WorkflowType {
      return repo.createWorkflow(o);
    },

    setTrigger(id, o, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      const def = catalog[o.type];
      if (!def) return { ok: false, error: `I don't know how to do "${o.type}" yet.` };
      const title = o.title ?? def.title;
      const trigger: StepInstance = {
        ...wf.trigger,
        type: o.type,
        title,
        summary: o.summary ?? def.description,
        config: o.config,
        inputs: {},
      };
      return done(`Set the trigger to "${title}".`, { ...wf, trigger }, opts?.by ?? 'agent', false);
    },

    addStep(id, o, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (!catalog[o.type]) {
        return { ok: false, error: `I don't know how to do "${o.type}" yet.` };
      }
      if (o.after !== undefined && !hasStep(wf, o.after)) {
        return { ok: false, error: `Unknown step: ${o.after}` };
      }
      // The new step's upstream is its `after` step plus everything before
      // that; with no `after` it has no upstream, so any binding is refused.
      const upstream =
        o.after === undefined
          ? new Set<string>()
          : new Set([...upstreamIds(wf, o.after), o.after]);
      const bad = badBinding(extractRefs(o.inputs), upstream);
      if (bad) return bad;
      const step: StepInstance = {
        id: `${slug(o.title)}-${nanoid(6)}`,
        type: o.type,
        title: o.title,
        summary: o.summary,
        config: o.config,
        inputs: o.inputs,
        position: { x: 0, y: 0 },
      };
      const edges =
        o.after === undefined ? wf.edges : [...wf.edges, { from: o.after, to: step.id }];
      const note =
        o.after === undefined
          ? `Added step "${o.title}".`
          : `Added step "${o.title}" after "${titleOf(wf, o.after)}".`;
      return done(note, { ...wf, steps: [...wf.steps, step], edges }, opts?.by ?? 'agent', false);
    },

    updateStep(id, stepId, patch, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (!hasStep(wf, stepId)) return { ok: false, error: `Unknown step: ${stepId}` };
      for (const key of Object.keys(patch)) {
        if (key !== 'title' && key !== 'summary' && key !== 'config' && key !== 'inputs') {
          return { ok: false, error: `Unknown field: ${key}` };
        }
      }
      // Replace semantics: an `inputs` patch is the step's whole new inputs,
      // so it — not a merge with the old bindings — is what gets validated.
      // A patch that leaves `inputs` alone is never refused for pre-existing
      // dangling bindings; checkWorkflow reports those for Dad to fix.
      if (patch.inputs !== undefined) {
        const bad = badBinding(
          extractRefs(patch.inputs),
          upstreamIds(wf, stepId),
          (s) => hasStep(wf, s),
        );
        if (bad) return bad;
      }
      const apply = (s: StepInstance): StepInstance => ({ ...s, ...patch });
      const next =
        wf.trigger.id === stepId
          ? { ...wf, trigger: apply(wf.trigger) }
          : { ...wf, steps: wf.steps.map((s) => (s.id === stepId ? apply(s) : s)) };
      return done(
        `Updated step "${titleOf(next, stepId)}".`,
        next,
        opts?.by ?? 'agent',
        false,
      );
    },

    removeStep(id, stepId, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (stepId === wf.trigger.id) return { ok: false, error: 'Cannot remove the trigger.' };
      if (!wf.steps.some((s) => s.id === stepId)) {
        return { ok: false, error: `Unknown step: ${stepId}` };
      }
      // Dependents keep their (now dangling) bindings: checkWorkflow reports
      // them and setStatus('on') stays blocked until they are fixed.
      const next = {
        ...wf,
        steps: wf.steps.filter((s) => s.id !== stepId),
        edges: wf.edges.filter((e) => e.from !== stepId && e.to !== stepId),
      };
      return done(`Removed step "${titleOf(wf, stepId)}".`, next, opts?.by ?? 'agent', false);
    },

    connect(id, o, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (!hasStep(wf, o.from)) return { ok: false, error: `Unknown step: ${o.from}` };
      if (!hasStep(wf, o.to)) return { ok: false, error: `Unknown step: ${o.to}` };
      if (wf.edges.some((e) => e.from === o.from && e.to === o.to)) {
        return {
          ok: false,
          error: `"${titleOf(wf, o.from)}" is already connected to "${titleOf(wf, o.to)}".`,
        };
      }
      const edges = [...wf.edges, { from: o.from, to: o.to, ...(o.when ? { when: o.when } : {}) }];
      try {
        topoOrder({ ...wf, edges });
      } catch {
        return { ok: false, error: 'These steps go round in a circle.' };
      }
      return done(
        `Connected "${titleOf(wf, o.from)}" to "${titleOf(wf, o.to)}".`,
        { ...wf, edges },
        opts?.by ?? 'agent',
        false,
      );
    },

    disconnect(id, o, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (!hasStep(wf, o.from)) return { ok: false, error: `Unknown step: ${o.from}` };
      if (!hasStep(wf, o.to)) return { ok: false, error: `Unknown step: ${o.to}` };
      if (!wf.edges.some((e) => e.from === o.from && e.to === o.to)) {
        return {
          ok: false,
          error: `"${titleOf(wf, o.from)}" isn't connected to "${titleOf(wf, o.to)}".`,
        };
      }
      const next = { ...wf, edges: wf.edges.filter((e) => !(e.from === o.from && e.to === o.to)) };
      return done(
        `Disconnected "${titleOf(wf, o.from)}" from "${titleOf(wf, o.to)}".`,
        next,
        opts?.by ?? 'agent',
        false,
      );
    },

    move(id, stepId, position, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (!hasStep(wf, stepId)) return { ok: false, error: `Unknown step: ${stepId}` };
      const next =
        wf.trigger.id === stepId
          ? { ...wf, trigger: { ...wf.trigger, position } }
          : { ...wf, steps: wf.steps.map((s) => (s.id === stepId ? { ...s, position } : s)) };
      return done(`Moved "${titleOf(wf, stepId)}".`, next, opts?.by ?? 'agent', true);
    },

    setStatus(id, status, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      if (status !== 'on' && status !== 'off') {
        return { ok: false, error: `Unknown status: ${status}` };
      }
      if (status === 'on') {
        const problems = checkWorkflow(wf, tables);
        const first = problems[0];
        if (first) {
          return {
            ok: false,
            error: `Cannot turn on yet: "${titleOf(wf, first.stepId)}": ${first.problem}`,
          };
        }
      }
      const note = status === 'on' ? `Turned on "${wf.name}".` : `Turned off "${wf.name}".`;
      return done(note, { ...wf, status }, opts?.by ?? 'agent', false);
    },

    rename(id, o, opts) {
      const wf = repo.getWorkflow(id);
      if (!wf) return { ok: false, error: `Unknown workflow: ${id}` };
      const next = {
        ...wf,
        name: o.name,
        ...(o.description !== undefined ? { description: o.description } : {}),
      };
      return done(`Renamed to "${o.name}".`, next, opts?.by ?? 'agent', false);
    },
  };
}
