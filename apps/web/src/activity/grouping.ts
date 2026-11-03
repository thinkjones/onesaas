import type { Run } from '@dad/shared';

export type TimeGroupKey = 'today' | 'week' | 'past';

export interface TimeGroup {
  key: TimeGroupKey;
  label: string;
  runs: Run[];
}

const DAY_MS = 86_400_000;

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Bucket runs for the Activity timeline: Today (same local calendar day as
 * `now`), This week (1–6 calendar days ago), Past (7+ days ago). Only
 * non-empty groups are returned, newest bucket first; runs keep input order
 * (callers pass newest-first). A future startedAt (clock skew) clamps to
 * today rather than vanishing.
 */
export function groupRunsByTime(runs: Run[], now: Date): TimeGroup[] {
  const today: Run[] = [];
  const week: Run[] = [];
  const past: Run[] = [];
  const todayStart = startOfLocalDay(now);
  for (const run of runs) {
    const diffDays = Math.max(
      0,
      Math.round((todayStart - startOfLocalDay(new Date(run.startedAt))) / DAY_MS),
    );
    if (diffDays === 0) today.push(run);
    else if (diffDays <= 6) week.push(run);
    else past.push(run);
  }
  const groups: TimeGroup[] = [];
  if (today.length > 0) groups.push({ key: 'today', label: 'Today', runs: today });
  if (week.length > 0) groups.push({ key: 'week', label: 'This week', runs: week });
  if (past.length > 0) groups.push({ key: 'past', label: 'Past', runs: past });
  return groups;
}
