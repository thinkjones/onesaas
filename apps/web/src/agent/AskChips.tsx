import AppButton from '../design/AppButton.tsx';

export interface AskChipsProps {
  options: string[];
  /** False for stale asks and while a turn runs: the chips show but don't act. */
  disabled: boolean;
  /** Sends the tapped option as Dad's message (same path as the textarea). */
  onSelect(text: string): void;
}

/** An `ask` event's options as tappable chips (Dad-sized, like the palette). */
export default function AskChips({ options, disabled, onSelect }: AskChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <AppButton
          key={option}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(option)}
        >
          {option}
        </AppButton>
      ))}
    </div>
  );
}
