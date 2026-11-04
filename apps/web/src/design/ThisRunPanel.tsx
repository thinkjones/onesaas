import type { StepRunStatus } from '@dad/shared';
import type { ReactNode } from 'react';
import AppButton from './AppButton.tsx';
import { plainLine } from '../runtime/format.ts';
import RunStrip from './RunStrip.tsx';

/**
 * The right-hand panel in Runs mode, where Chat sits in Design: who this run is
 * about, how far it got, and the story of it in one paragraph. The last line
 * is what's happening now, so it's the bold one.
 */
export default function ThisRunPanel({
  name,
  started,
  statuses,
  story,
  note,
  onChangeDesign,
  children,
}: {
  name: string;
  started: string;
  statuses: StepRunStatus[];
  story: string[];
  /** Shown when the run used an earlier version of the design. */
  note?: string;
  onChangeDesign(): void;
  children?: ReactNode;
}) {
  const lines = story.map(plainLine);
  const last = lines[lines.length - 1];
  return (
    <aside
      aria-label="This run"
      data-testid="run-story"
      className="absolute top-20 right-3.5 z-20 flex max-h-[calc(100%-6rem)] w-[360px] flex-col gap-3 overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-5 shadow-md"
    >
      <span className="section-label text-accent-2">This run · Real</span>
      <h2 className="m-0 text-[1.294rem] font-bold break-words">{name}</h2>
      <span className="text-[0.824rem] text-muted-foreground">{started}</span>
      <RunStrip statuses={statuses} />
      <p className="m-0 text-[0.882rem] leading-[1.55]">
        {lines.slice(0, -1).join(' ')} {last !== undefined && <b className="font-semibold">{last}</b>}
      </p>
      {note && <p className="m-0 text-[0.765rem] text-muted-foreground">{note}</p>}
      <div className="flex items-center gap-2.5 border-t border-border pt-3">
        <AppButton variant="soft" size="sm" className="min-h-0" onClick={onChangeDesign}>
          Change how this works
        </AppButton>
        <span className="text-[0.706rem] text-muted-foreground">Opens Design</span>
      </div>
      {children}
    </aside>
  );
}
