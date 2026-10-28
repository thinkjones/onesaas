import { z } from 'zod';

export const StepInstance = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
  config: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.string()),
  position: z.object({ x: z.number(), y: z.number() }),
});
export type StepInstance = z.infer<typeof StepInstance>;

export const Edge = z.object({
  from: z.string(),
  to: z.string(),
  when: z.string().optional(),
});
export type Edge = z.infer<typeof Edge>;

export const WorkflowStatus = z.enum(['draft', 'on', 'off']);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const Workflow = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.number(),
    status: WorkflowStatus,
    trigger: StepInstance,
    steps: z.array(StepInstance),
    edges: z.array(Edge),
  })
  .superRefine((wf, ctx) => {
    const ids = new Set([wf.trigger.id, ...wf.steps.map((s) => s.id)]);
    wf.edges.forEach((edge, i) => {
      if (!ids.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'from'],
          message: `Unknown edge source: ${edge.from}`,
        });
      }
      if (!ids.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'to'],
          message: `Unknown edge target: ${edge.to}`,
        });
      }
    });
  });
export type Workflow = z.infer<typeof Workflow>;

/** Topological order of trigger + step ids via Kahn's algorithm. Ready nodes are processed in insertion order with the trigger first, so the result is deterministic. Throws `Workflow has a cycle` when edges remain but no ready node exists. */
export function topoOrder(wf: Workflow): string[] {
  const nodes = [wf.trigger.id, ...wf.steps.map((s) => s.id)];
  const known = new Set(nodes);
  const indegree = new Map<string, number>(nodes.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((id) => [id, []]));
  for (const edge of wf.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    outgoing.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  const ready = nodes.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of outgoing.get(id)!) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  if (order.length < nodes.length) throw new Error('Workflow has a cycle');
  return order;
}
