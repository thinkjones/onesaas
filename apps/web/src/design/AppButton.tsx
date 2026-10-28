import { cn } from 'cn';
import * as React from 'react';
import { Button } from '../components/ui/button.tsx';

/** The one button in the app: shadcn Button, always ≥40px tall, 16px+ text. */
export type AppButtonProps = React.ComponentProps<typeof Button>;

export default function AppButton({ className, size = 'lg', ...props }: AppButtonProps) {
  return <Button size={size} className={cn('min-h-10 text-base', className)} {...props} />;
}
