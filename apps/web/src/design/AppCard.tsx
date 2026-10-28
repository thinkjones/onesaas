import { cn } from 'cn';
import * as React from 'react';
import { Card } from '../components/ui/card.tsx';

/**
 * The one card in the app: paper surface (Morning --card), THE single corner
 * radius (--radius), soft shadow (--shadow-sm). Wraps the shadcn Card so its
 * Header/Title/Description/Content/Footer subcomponents compose inside.
 * Screens must not invent their own card colours, radii or shadows.
 */
export default function AppCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <Card
      className={cn('rounded-[var(--radius)] border-border bg-card shadow-sm', className)}
      {...props}
    />
  );
}
