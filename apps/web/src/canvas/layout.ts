import type { StepInstance, Workflow } from '@dad/shared';
import dagre from 'dagre';

/** A step card's width in the flow column. */
export const NODE_WIDTH = 470;
// Only a first guess: real heights replace it once cards are measured.
const NODE_HEIGHT = 84;
// Dagre packs from (0,0); the margin keeps laid-out nodes off the exact
// origin so {0,0} stays an unambiguous "unpositioned" marker.
const MARGIN = 40;

export interface LayoutOptions {
  /** Measured card sizes by step id, so tall or expanded cards never collide. */
  sizes?: Record<string, { width: number; height: number }>;
  /** Vertical gap between cards. */
  gap?: number;
}

/**
 * Lays the whole graph out top-down via dagre. Positions are always computed:
 * nodes aren't draggable, so there are no user positions to keep. Returns a
 * new Workflow without mutating the input. Deterministic, so re-renders never
 * shift boxes. A card wider than the column (an expanded step) keeps the
 * column's left edge when it's alone on its row, so the flow stays one line.
 */
export function layoutWorkflow(wf: Workflow, { sizes, gap = 44 }: LayoutOptions = {}): Workflow {
  const all = [wf.trigger, ...wf.steps];
  const sizeOf = (id: string) => ({
    width: sizes?.[id]?.width ?? NODE_WIDTH,
    height: sizes?.[id]?.height ?? NODE_HEIGHT,
  });
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: gap });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of all) g.setNode(s.id, sizeOf(s.id));
  for (const e of wf.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const onRow = new Map<number, number>();
  for (const s of all) {
    const y = Math.round(g.node(s.id).y);
    onRow.set(y, (onRow.get(y) ?? 0) + 1);
  }
  const leftOf = (s: StepInstance): number => {
    const n = g.node(s.id);
    const { width } = sizeOf(s.id);
    const alone = onRow.get(Math.round(n.y)) === 1;
    return n.x - (width > NODE_WIDTH && alone ? NODE_WIDTH : width) / 2;
  };
  // An expanded card widens dagre's whole graph; the flow's left edge stays put.
  const left = Math.min(...all.map(leftOf));
  const place = (s: StepInstance): StepInstance => ({
    ...s,
    position: {
      x: Math.round(leftOf(s) - left + MARGIN),
      y: Math.round(g.node(s.id).y - sizeOf(s.id).height / 2 + MARGIN),
    },
  });
  return { ...wf, trigger: place(wf.trigger), steps: wf.steps.map(place) };
}

/** Step numbers in reading order: top to bottom, then left to right. */
export function stepNumbers(wf: Workflow): Record<string, number> {
  const ordered = [wf.trigger, ...wf.steps].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  return Object.fromEntries(ordered.map((s, i) => [s.id, i + 1]));
}
