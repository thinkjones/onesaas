import type { LucideIcon } from 'lucide-react';

/**
 * Craft card heading (§7): an h3 that always leads with a Lucide icon, with
 * an optional `· N` count and an optional one-line dim description.
 */
export default function CardHeading({
  icon: Icon,
  title,
  count,
  description,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  description?: string;
}) {
  return (
    <h3>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span>
        {title}
        {count !== undefined && ` · ${count}`}
      </span>
      {description !== undefined && (
        <span className="text-[0.82rem] font-normal text-muted-foreground">{description}</span>
      )}
    </h3>
  );
}
