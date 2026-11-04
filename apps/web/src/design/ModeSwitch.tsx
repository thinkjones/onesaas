import type { Run } from '@onesaas/shared';
import History from 'lucide-react/icons/history';
import Pencil from 'lucide-react/icons/pencil';

/** One board, two modes: violet is designing, coral is real runs. */
export default function ModeSwitch({
  runsMode,
  runs,
  onChange,
}: {
  runsMode: boolean;
  runs: Run[] | undefined;
  onChange(runsMode: boolean): void;
}) {
  const waiting = (runs ?? []).filter((r) => r.status === 'waiting').length;
  return (
    <div role="group" aria-label="Design or runs" className="mode-switch" data-mode={runsMode ? 'runs' : 'design'}>
      <button type="button" data-segment="design" aria-pressed={!runsMode} onClick={() => onChange(false)}>
        <Pencil size={15} aria-hidden />
        Design
      </button>
      <button type="button" data-segment="runs" aria-pressed={runsMode} onClick={() => onChange(true)}>
        <History size={15} aria-hidden />
        Runs · {runs?.length ?? 0}
        {waiting > 0 && !runsMode && <span className="waiting-dot" role="img" aria-label={`${waiting} waiting`} />}
      </button>
    </div>
  );
}
