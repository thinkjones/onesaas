import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getViewData, useBusinessTimezone, useLists, useViews } from '../api.ts';
import ViewRenderer from '../lists/ViewRenderer.tsx';

// "Your business at a glance" (M5 Task 6): every pinned view rendered with
// the M4 ViewRenderer, or the empty hint (verbatim, pinned by
// HomePage.test.tsx) when nothing is pinned.

export const AT_A_GLANCE_EMPTY =
  "Ask me to keep an eye on something, like 'how many new customers this week?'";

export default function AtAGlance() {
  const views = useViews();
  const lists = useLists();
  const timezone = useBusinessTimezone();
  const pinned = useMemo(() => (views.data ?? []).filter((v) => v.pinned), [views.data]);
  const datas = useQueries({
    queries: pinned.map((v) => ({
      queryKey: ['view-data', v.id],
      queryFn: () => getViewData(v.id),
    })),
  });

  if (views.isPending || lists.isPending) return <p>Loading your business at a glance…</p>;
  if (views.isError || lists.isError || !views.data || !lists.data) {
    return <p role="alert">Couldn&apos;t load your pinned views. Try again.</p>;
  }
  return (
    <section aria-label="Your business at a glance" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Your business at a glance</h2>
      {pinned.length === 0 ? (
        <p>{AT_A_GLANCE_EMPTY}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {pinned.map((view, i) => {
            const table = lists.data.find((t) => t.name === view.table);
            const data = datas[i];
            return (
              <article key={view.id} aria-label={view.title} className="flex flex-col gap-2">
                {!table || !data ? (
                  <p role="alert">Couldn&apos;t load this view.</p>
                ) : data.data ? (
                  <ViewRenderer
                    view={view}
                    table={table}
                    data={data.data}
                    timezone={timezone.data?.timezone ?? null}
                  />
                ) : data.isError ? (
                  <p role="alert">Couldn&apos;t load this number. Try again.</p>
                ) : (
                  <p>Loading…</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
