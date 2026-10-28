import type { LucideIcon } from 'lucide-react';
import AppButton from './AppButton.tsx';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: EmptyStateAction;
}

/** Friendly centred placeholder: icon, title, one-line hint, optional action. */
export default function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-md text-base text-muted-foreground">{hint}</p>
      {action ? (
        <AppButton className="mt-2" onClick={action.onClick}>
          {action.label}
        </AppButton>
      ) : null}
    </div>
  );
}
