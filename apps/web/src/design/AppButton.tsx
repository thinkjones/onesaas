import { cn } from 'cn';
import * as React from 'react';
import { Button } from '../components/ui/button.tsx';

/** The one button in the app: shadcn Button. Full-size ones are at least 40px tall. */
export type AppButtonProps = React.ComponentProps<typeof Button>;

export default function AppButton({ className, size = 'lg', ...props }: AppButtonProps) {
  return <Button size={size} className={cn(size === 'lg' && 'min-h-10 text-[0.941rem]', className)} {...props} />;
}
