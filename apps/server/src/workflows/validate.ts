import { catalog, topoOrder, type Workflow } from '@dad/shared';
import type { TableStore } from '../tables/store.js';

export interface WorkflowProblem {
  stepId: string;
  problem: string;
}

// The same scan resolveBindings uses: every `{{...}}` template in every input.
const TEMPLATE_PATTERN = /\{\{(.+?)\}\}/g;

export interface BindingRef {
  /** The full expression as written, e.g. `extract.name`. */
  ref: string;
  /** The first path segment, treated as the step id. */
  stepId: string;
}

/** All binding references in an inputs record, in input order. */
export function extractRefs(inputs: Record<string, string>): BindingRef[] {
  const out: BindingRef[] = [];
  for (const value of Object.values(inputs)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(TEMPLATE_PATTERN)) {
      const ref = match[1].trim();
      out.push({ ref, stepId: ref.split('.')[0]?.trim() ?? '' });
    }
  }
  return out;
}

/** Ids reachable by walking edges backwards from `stepId` (the step itself excluded). */
export function upstreamIds(wf: Workflow, stepId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of wf.edges) {
    const list = incoming.get(edge.to);
    if (list) list.push(edge.from);
    else incoming.set(edge.to, [edge.from]);
  }
  const seen = new Set<string>();
  const queue = [...(incoming.get(stepId) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(incoming.get(cur) ?? []));
  }
  return seen;
}

/** Ids reachable by walking edges forwards from `stepId`. */
function downstreamIds(wf: Workflow, stepId: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of wf.edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge.to);
    else outgoing.set(edge.from, [edge.to]);
  }
  const seen = new Set<string>();
  const queue = [...(outgoing.get(stepId) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(outgoing.get(cur) ?? []));
  }
  return seen;
}

/**
 * Steps that sit ON a cycle: topoOrder says whether one exists, and a node is
 * on it exactly when it can reach itself. (Nodes merely downstream of a cycle
 * are not members, so they are found this way rather than via Kahn leftovers.)
 */
function cycleMembers(wf: Workflow): Set<string> {
  try {
    topoOrder(wf);
  } catch {
    const ids = [wf.trigger.id, ...wf.steps.map((s) => s.id)];
    const members = new Set<string>();
    for (const id of ids) {
      if (downstreamIds(wf, id).has(id)) members.add(id);
    }
    return members;
  }
  return new Set();
}

/**
 * Plain-English problems blocking a workflow from being turned on, in a
 * deterministic order: cycle members first (in workflow order), then each
 * node in workflow order (trigger, then steps) with its config, binding,
 * list and reachability problems, then edge-condition problems in edge order.
 */

// Sort-condition shape, shared with the canvas picker (edgeConditions.ts):
// `<stepId>.choice == '<option>'`. Step ids are slugs, so `[\w-]` covers them.
const CHOICE_PATTERN = /^([\w-]+)\.choice == '([^']*)'$/;
export function checkWorkflow(wf: Workflow, tables: TableStore): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const nodes = [wf.trigger, ...wf.steps];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const members = cycleMembers(wf);
  for (const node of nodes) {
    if (members.has(node.id)) {
      problems.push({ stepId: node.id, problem: 'These steps go round in a circle.' });
    }
  }

  const reachable = downstreamIds(wf, wf.trigger.id);
  for (const node of nodes) {
    const def = catalog[node.type];
    if (!def) {
      problems.push({ stepId: node.id, problem: `I don't know how to do "${node.type}" yet.` });
      continue;
    }
    const config = def.configSchema.safeParse(node.config);
    if (!config.success) {
      const first = config.error.issues[0];
      const where = first && first.path.length > 0 ? first.path.join('.') : 'config';
      problems.push({
        stepId: node.id,
        problem: `This step isn't set up yet: ${where} is missing.`,
      });
    }
    const upstream = upstreamIds(wf, node.id);
    const seenRefs = new Set<string>();
    for (const { ref, stepId } of extractRefs(node.inputs)) {
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      if (!byId.has(stepId)) {
        problems.push({ stepId: node.id, problem: 'Needs an input from a removed step.' });
      } else if (!upstream.has(stepId)) {
        problems.push({
          stepId: node.id,
          problem: `Needs an input from a step that isn't before it ("${ref}").`,
        });
      }
    }
    const table = node.config['table'];
    if (node.type.startsWith('table.') && typeof table === 'string' && !tables.getTable(table)) {
      problems.push({ stepId: node.id, problem: `The list "${table}" doesn't exist yet.` });
    }
    if (node.id !== wf.trigger.id && !reachable.has(node.id) && !members.has(node.id)) {
      problems.push({ stepId: node.id, problem: 'Nothing leads to this step yet.' });
    }
  }
  // Sort-shaped edge conditions must name a live ai.classify step and one of
  // its current options. Anything else would silently skip the branch at
  // runtime (evalCondition is false-on-error), so it blocks activation on the
  // edge target. General jexl passes through unchecked.
  const DEFAULT_OPTIONS = ['yes', 'no'];
  for (const edge of wf.edges) {
    if (edge.when === undefined) continue;
    const match = CHOICE_PATTERN.exec(edge.when.trim());
    if (!match) continue;
    const stepId = match[1]!;
    const option = match[2]!;
    const source = byId.get(stepId);
    if (!source) {
      problems.push({
        stepId: edge.to,
        problem: `The condition refers to a removed step ("${stepId}").`,
      });
      continue;
    }
    if (source.type !== 'ai.classify') {
      problems.push({
        stepId: edge.to,
        problem: `The condition refers to "${source.title}", which doesn't sort into options.`,
      });
      continue;
    }
    const rawOptions = source.config['options'] as unknown;
    const effective = rawOptions === undefined ? DEFAULT_OPTIONS : rawOptions;
    // A non-array options is a config problem on the sort step itself (already
    // reported above); only membership is the edge's problem.
    if (Array.isArray(effective) && !effective.includes(option)) {
      problems.push({
        stepId: edge.to,
        problem: `The condition uses "${option}", which "${source.title}" no longer offers.`,
      });
    }
  }
  return problems;
}
