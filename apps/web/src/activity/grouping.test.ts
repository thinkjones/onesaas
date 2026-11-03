import type { Run } from '@dad/shared';
import { describe, expect, test } from 'vitest';
import { groupRunsByTime } from './grouping.ts';

function run(id: string, startedAt: string): Run {
  return {
    id,
    workflowId: 'wf-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt,
  };
}

// Local-constructed ISO: parses back to the same local calendar day in any
// timezone, so midnight boundaries never flip under a different TZ.
function iso(dayOffset: number, hour: number, minute = 0): string {
  return new Date(2026, 10, 3 + dayOffset, hour, minute).toISOString();
}

const NOW = new Date(2026, 10, 3, 15, 30);

describe('groupRunsByTime', () => {
  test('buckets runs into today, this week, and past', () => {
    const groups = groupRunsByTime(
      [run('today', iso(0, 9)), run('yesterday', iso(-1, 12)), run('old', iso(-10, 8))],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'Past']);
    expect(groups.map((g) => g.runs.map((r) => r.id))).toEqual([['today'], ['yesterday'], ['old']]);
  });

  test('midnight belongs to the new day', () => {
    const groups = groupRunsByTime(
      [run('midnight', iso(0, 0)), run('late', iso(-1, 23, 59))],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week']);
    expect(groups[0]!.runs.map((r) => r.id)).toEqual(['midnight']);
  });

  test('six days ago is this week, seven days ago is past', () => {
    const groups = groupRunsByTime([run('six', iso(-6, 12)), run('seven', iso(-7, 12))], NOW);
    expect(groups.map((g) => g.label)).toEqual(['This week', 'Past']);
  });

  test('empty input returns no groups', () => {
    expect(groupRunsByTime([], NOW)).toEqual([]);
  });

  test('a future run (clock skew) lands in today', () => {
    const groups = groupRunsByTime([run('future', iso(1, 9))], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today']);
  });
});
