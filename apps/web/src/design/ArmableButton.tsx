import { useEffect, useRef, useState } from 'react';
import AppButton from './AppButton.tsx';

/** How long an armed button stays armed before standing down. */
const ARM_MS = 5000;

/**
 * A destructive button that needs two taps: the first tap arms it (label
 * switches to the confirm text), the second fires. Arming expires after
 * ARM_MS so a stray first tap never sits loaded.
 */
export default function ArmableButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  compact,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Fits a toolbar (the floating bar) rather than a form. */
  compact?: boolean;
}) {
  const sizing = compact ? ({ size: 'sm', className: 'min-h-0 text-sm' } as const) : {};
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  if (!armed) {
    return (
      <AppButton
        type="button"
        variant="destructive"
        {...sizing}
        disabled={disabled}
        onClick={() => {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), ARM_MS);
        }}
      >
        {label}
      </AppButton>
    );
  }
  return (
    <AppButton
      type="button"
      variant="destructive"
      {...sizing}
      disabled={disabled}
      onClick={() => {
        if (timer.current !== null) clearTimeout(timer.current);
        setArmed(false);
        onConfirm();
      }}
    >
      {confirmLabel}
    </AppButton>
  );
}
