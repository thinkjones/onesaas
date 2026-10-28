import AppButton from '../design/AppButton.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.tsx';
import type { WorkflowMode } from '../runtime/params.ts';

export interface ModeSwitchProps {
  mode: WorkflowMode;
  onModeChange(mode: WorkflowMode): void;
}

/**
 * The big two-part "Design | Watch it run" control. Design is disabled with a
 * "Coming soon" tooltip until M3. (A disabled button swallows hover, so a span
 * carries the tooltip trigger.)
 */
export default function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Mode"
      className="inline-flex gap-1 self-start rounded-[var(--radius)] bg-muted p-1"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <AppButton variant={mode === 'design' ? 'default' : 'ghost'} disabled>
              Design
            </AppButton>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming soon</TooltipContent>
      </Tooltip>
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
