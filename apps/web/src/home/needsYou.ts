import type { Run, Workflow } from '@dad/shared';

/** The run a card shows: an unanswered one outranks a newer finished one. */
export function runToShow(workflowId: string, runs: Run[]): Run | undefined {
  const mine = runs
    .filter((r) => r.workflowId === workflowId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return mine.findLast((r) => r.status === 'waiting') ?? mine[0];
}

export function needsYouRank(status: Run['status'] | undefined): number {
  return status === 'waiting' ? 0 : status === 'failed' ? 1 : 2;
}

/** How many automations need you. An old failure that a later run replaced doesn't count. */
export function countNeedingYou(workflowIds: string[], runs: Run[]): number {
  return workflowIds.filter((id) => needsYouRank(runToShow(id, runs)?.status) < 2).length;
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** The one-line state of things under the page title. */
export function automationsSummary(workflows: Workflow[], runs: Run[]): string {
  const needing = countNeedingYou(workflows.map((w) => w.id), runs);
  if (needing === 0) return 'All ticking along.';
  if (needing === workflows.length) return needing === 1 ? 'This one needs you.' : 'All of them need you.';
  const count = COUNT_WORDS[needing] ?? String(needing);
  return `${count} ${needing === 1 ? 'needs' : 'need'} you. The rest are ticking along.`;
}
