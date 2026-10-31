import { formatRunListTime } from '../runtime/format.ts';

export interface ActivityEntry {
  at: string;
  text: string;
}

/**
 * "Recent changes" (Bug #4): the RHS log of what changed in the design —
 * steps built, added, copied and deleted, plus node questions. Newest
 * first, capped by the page. Rendered only when non-empty.
 */
export default function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  return (
    <section
      aria-label="Recent changes"
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold">Recent changes</h2>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="text-sm text-muted-foreground">
            <span className="whitespace-nowrap">{formatRunListTime(e.at)}</span> — {e.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
