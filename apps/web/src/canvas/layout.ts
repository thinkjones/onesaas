import type { StepInstance, Workflow } from '@dad/shared';
import dagre from 'dagre';

// StepNode is 280px wide; the height estimate only needs to be plausible for
// rank spacing (nodesep), since only x-ordering is contractually asserted.
const NODE_WIDTH = 280;
const NODE_HEIGHT = 140;
// Dagre packs from (0,0); the margin keeps laid-out nodes off the exact
// origin so {0,0} stays an unambiguous "unpositioned" marker.
const MARGIN = 40;

function isUnpositioned(s: StepInstance): boolean {
  return s.position.x === 0 && s.position.y === 0;
}

/**
 * Fills missing ({0,0}) or overlapping positions left-to-right via dagre
 * (rankdir LR, nodesep 60, ranksep 120). Nodes with a distinct non-zero
 * position keep it; of overlapping duplicates the first keeps its spot.
 * Returns a new Workflow; the input is not mutated. When nothing needs
 * layout, returns the input unchanged (same reference).
 */
export function layoutWorkflow(wf: Workflow): Workflow {
  const all = [wf.trigger, ...wf.steps];
  const counts = new Map<string, number>();
  for (const s of all) {
    const key = `${s.position.x},${s.position.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kept = new Set<string>();
  const free = new Set<string>();
  for (const s of all) {
    if (isUnpositioned(s)) {
      free.add(s.id);
      continue;
    }
    const key = `${s.position.x},${s.position.y}`;
    if ((counts.get(key) ?? 0) > 1 && kept.has(key)) {
      free.add(s.id); // overlapping duplicate: re-layout
    } else {
      kept.add(key);
    }
  }
  if (free.size === 0) return wf;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of all) g.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of wf.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const place = (s: StepInstance): StepInstance => {
    if (!free.has(s.id)) return s;
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
