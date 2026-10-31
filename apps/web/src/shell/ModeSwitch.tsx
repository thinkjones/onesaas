import AppButton from '../design/AppButton.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import type { WorkflowMode } from '../runtime/params.ts';

export interface ModeSwitchProps {
  mode: WorkflowMode;
  onModeChange(mode: WorkflowMode): void;
}

const EXPLAIN_TARGET = { kind: 'ui' as const, id: 'mode-switch' };
const EXPLAIN_LABEL = 'Design and Watch it run';

/** The big two-part "Design | Watch it run" control. */
export default function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div
      data-explain={dataExplainValue(EXPLAIN_TARGET, EXPLAIN_LABEL)}
      className="inline-flex items-center gap-1 self-start"
    >
      <div
        role="group"
        aria-label="Mode"
        className="inline-flex gap-1 rounded-[var(--radius)] bg-muted p-1"
      >
        <AppButton
          variant={mode === 'design' ? 'default' : 'ghost'}
          aria-pressed={mode === 'design'}
          onClick={() => onModeChange('design')}
        >
          Design
        </AppButton>
        <AppButton
          variant={mode === 'runtime' ? 'default' : 'ghost'}
          aria-pressed={mode === 'runtime'}
          onClick={() => onModeChange('runtime')}
        >
          Watch it run
        </AppButton>
      </div>
      <Explain target={EXPLAIN_TARGET} label={EXPLAIN_LABEL} />
    </div>
  );
}
