import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import type { WorkflowMode } from '../runtime/params.ts';

export interface ModeSwitchProps {
  mode: WorkflowMode;
  onModeChange(mode: WorkflowMode): void;
}

const EXPLAIN_TARGET = { kind: 'ui' as const, id: 'mode-switch' };
const EXPLAIN_LABEL = 'Design and Watch it run';

/** The "Design | Watch it run" segmented control (§9). */
export default function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div
      data-explain={dataExplainValue(EXPLAIN_TARGET, EXPLAIN_LABEL)}
      className="inline-flex items-center gap-1 self-start"
    >
      <div className="seg" role="group" aria-label="Mode">
        <button
          type="button"
          aria-pressed={mode === 'design'}
          className={mode === 'design' ? 'on' : ''}
          onClick={() => onModeChange('design')}
        >
          Design
        </button>
        <button
          type="button"
          aria-pressed={mode === 'runtime'}
          className={mode === 'runtime' ? 'on' : ''}
          onClick={() => onModeChange('runtime')}
        >
          Watch it run
        </button>
      </div>
      <Explain target={EXPLAIN_TARGET} label={EXPLAIN_LABEL} />
    </div>
  );
}
