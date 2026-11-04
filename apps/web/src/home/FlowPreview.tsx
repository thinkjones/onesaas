import type { FlowIconName, FlowStep } from '@dad/shared';
import {
  ArrowRight,
  Bell,
  Calculator,
  Calendar,
  Camera,
  Check,
  Clock,
  Database,
  DollarSign,
  FileText,
  Image,
  Inbox,
  Mail,
  MessageSquare,
  MousePointerClick,
  Package,
  PenLine,
  Phone,
  Play,
  Repeat,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Tags,
  Truck,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';

const ICONS: Record<FlowIconName, LucideIcon> = {
  Bell,
  Calculator,
  Calendar,
  Camera,
  Check,
  Clock,
  Database,
  DollarSign,
  FileText,
  Image,
  Inbox,
  Mail,
  MessageSquare,
  MousePointerClick,
  Package,
  PenLine,
  Phone,
  Play,
  Repeat,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Tags,
  Truck,
  Users,
  Zap,
};

const MAX_NODES = 5;

/** A row of step tiles. Decorative: the title beside it carries the meaning. */
export default function FlowPreview({ steps, size }: { steps: FlowStep[]; size: 'idea' | 'card' }) {
  const shown = steps.slice(0, MAX_NODES);
  const more = steps.length - shown.length;
  return (
    <span aria-hidden="true" className="flow-preview" data-size={size}>
      {shown.map((step, i) => {
        const Icon = ICONS[step.icon];
        return (
          <Fragment key={i}>
            {i > 0 && <ArrowRight className="flow-arrow" />}
            <span
              className="flow-node"
              style={{ background: `var(--kind-${step.kind}-bg)`, color: `var(--kind-${step.kind}-fg)` }}
            >
              <Icon />
            </span>
          </Fragment>
        );
      })}
      {more > 0 && (
        <>
          <ArrowRight className="flow-arrow" />
          <span className="flow-node flow-more">+{more}</span>
        </>
      )}
    </span>
  );
}
