import type { StepInstance, Workflow } from '@dad/shared';
import dagre from 'dagre';

// StepNode is 280px wide; the height estimate only needs to be plausible for
// rank spacing (nodesep), since only y-ordering is contractually asserted.
const NODE_WIDTH = 280;
const NODE_HEIGHT = 140;
// Dagre packs from (0,0); the margin keeps laid-out nodes off the exact
// origin so {0,0} stays an unambiguous "unpositioned" marker.
const MARGIN = 40;

/**
 * Lays the whole graph out top-down via dagre (rankdir TB, nodesep 60,
 * ranksep 120). Positions are always computed — nodes are not draggable
 * (Bug #4), so there are no user positions to preserve. Returns a new
 * Workflow; the input is not mutated. Deterministic: the same graph always
 * yields the same positions, so re-renders never shift boxes.
 */
export function layoutWorkflow(wf: Workflow): Workflow {
  const all = [wf.trigger, ...wf.steps];
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of all) g.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of wf.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const place = (s: StepInstance): StepInstance => {
    const n = g.node(s.id);
    return {
      ...s,
      position: {
        x: Math.round(n.x - NODE_WIDTH / 2 + MARGIN),
        y: Math.round(n.y - NODE_HEIGHT / 2 + MARGIN),
      },
    };
  };
  return { ...wf, trigger: place(wf.trigger), steps: wf.steps.map(place) };
}
