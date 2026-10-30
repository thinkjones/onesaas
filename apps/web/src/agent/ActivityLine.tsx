import { Loader2 } from 'lucide-react';

export interface ActivityLineProps {
  text: string;
  /** The spinner runs while the turn runs; the line itself always stays. */
  busy: boolean;
}

/** One `activity` event: a small grey line on the agent's side. */
export default function ActivityLine({ text, busy }: ActivityLineProps) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {busy && (
        <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      )}
      {text}
    </p>
  );
}
