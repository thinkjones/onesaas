import type { StepKind } from '@dad/shared';
import {
  Database,
  Inbox,
  Send,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Kind → icon + chip tint. Tints are Task 3/3b token utilities ONLY
// (no-one-off rule); the status badge — not this tint — carries run state.
// Mapping rationale:
// - trigger → primary: the start of the chore gets the warm lead colour.
// - fetch → info: reading (Gmail) is informational blue.
// - enrich → accent: AI shaping gets the green-teal accent.
// - store → muted: filing into a list is quiet/neutral.
// - act → warning: side-effecting steps (draft, approval) get attention-amber.
export const stepVisuals: Record<StepKind, { icon: LucideIcon; tint: string }> = {
  trigger: { icon: Zap, tint: 'bg-primary/15 text-primary' },
  fetch: { icon: Inbox, tint: 'bg-info/15 text-info' },
  enrich: { icon: Sparkles, tint: 'bg-accent/15 text-accent' },
  store: { icon: Database, tint: 'bg-muted text-muted-foreground' },
  act: { icon: Send, tint: 'bg-warning/15 text-warning' },
};
