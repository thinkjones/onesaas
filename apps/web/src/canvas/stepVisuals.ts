import type { StepKind } from '@dad/shared';
import {
  Database,
  Inbox,
  Send,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Kind → icon + tile tint (--kind-* tokens). The status, not this tint, carries
// run state; approval steps swap Send for a shield in StepNode.
export const stepVisuals: Record<StepKind, { icon: LucideIcon; tint: string }> = {
  trigger: { icon: Zap, tint: 'bg-[var(--kind-trigger-bg)] text-[var(--kind-trigger-fg)]' },
  fetch: { icon: Inbox, tint: 'bg-[var(--kind-fetch-bg)] text-[var(--kind-fetch-fg)]' },
  enrich: { icon: Sparkles, tint: 'bg-[var(--kind-enrich-bg)] text-[var(--kind-enrich-fg)]' },
  store: { icon: Database, tint: 'bg-[var(--kind-store-bg)] text-[var(--kind-store-fg)]' },
  act: { icon: Send, tint: 'bg-[var(--kind-act-bg)] text-[var(--kind-act-fg)]' },
};
