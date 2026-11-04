import { useQueries } from '@tanstack/react-query';
import type { Run } from '@dad/shared';
import XIcon from 'lucide-react/icons/x';
import type { ReactNode } from 'react';
import { getRun } from '../api.ts';
import RunsList from '../runtime/RunsList.tsx';
import AppButton from './AppButton.tsx';

/**
 * Floats over the canvas: pick a run and its progress is laid over the
 * automation's steps. `children` is for anything that starts a run here.
 */
export default function RunsPanel({
  runs,
  selectedRunId,
  onSelect,
  onClearOverlay,
  onClose,
  summary,
  children,
}: {
  runs: Run[];
  selectedRunId: string | undefined;
  onSelect(runId: string): void;
  onClearOverlay(): void;
  onClose(): void;
  /** What happened in the overlaid run. */
  summary?: ReactNode;
  children?: ReactNode;
}) {
  const stories = useQueries({
    queries: runs.map((r) => ({ queryKey: ['run', r.id], queryFn: () => getRun(r.id) })),
  });
  const lastLineByRunId: Record<string, string | undefined> = {};
  for (const [i, r] of runs.entries()) {
    const story = stories[i]?.data?.story;
    lastLineByRunId[r.id] = story?.[story.length - 1];
  }
  return (
    <aside
      aria-label="Runs"
      data-testid="runs-panel"
      className="absolute top-20 bottom-4 left-3 z-20 flex w-[400px] flex-col gap-2 overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-3 shadow-md"
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto font-semibold">Runs</h2>
        {selectedRunId !== undefined && (
          <AppButton variant="ghost" size="sm" className="min-h-0 text-sm" onClick={onClearOverlay}>
            Clear overlay
          </AppButton>
        )}
        <AppButton variant="ghost" size="icon-sm" className="min-h-0" aria-label="Close runs" onClick={onClose}>
          <XIcon aria-hidden />
        </AppButton>
      </div>
      {children}
      {summary}
      {runs.length === 0 ? (
        <p className="text-muted-foreground">No runs yet. Publish this automation or try it.</p>
      ) : (
        <RunsList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={onSelect}
          lastLineByRunId={lastLineByRunId}
        />
      )}
    </aside>
  );
}
