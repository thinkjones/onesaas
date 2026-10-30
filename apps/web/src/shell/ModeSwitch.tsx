import AppButton from '../design/AppButton.tsx';
import type { WorkflowMode } from '../runtime/params.ts';

export interface ModeSwitchProps {
  mode: WorkflowMode;
  onModeChange(mode: WorkflowMode): void;
}

/** The big two-part "Design | Watch it run" control. */
export default function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Mode"
      className="inline-flex gap-1 self-start rounded-[var(--radius)] bg-muted p-1"
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
  );
}
