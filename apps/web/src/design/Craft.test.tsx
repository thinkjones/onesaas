import InboxIcon from 'lucide-react/icons/inbox';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import CardHeading from './CardHeading.tsx';
import Pill from './Pill.tsx';

test('card heading leads with an icon, title, count and description', () => {
  render(
    <CardHeading icon={InboxIcon} title="Runs" count={3} description="Newest first" />,
  );
  const h3 = screen.getByRole('heading', { name: /Runs · 3/ });
  expect(h3.textContent).toContain('Newest first');
  expect(h3.querySelector('svg')).not.toBeNull();
});

test('card heading omits count and description when absent', () => {
  render(<CardHeading icon={InboxIcon} title="Runs" />);
  expect(screen.getByRole('heading', { name: 'Runs' }).textContent).toBe('Runs');
});

test('pill renders each tone', () => {
  const { rerender } = render(<Pill tone="waiting">2 waiting</Pill>);
  expect(screen.getByText('2 waiting').className).toMatch(/bg-warning-soft/);
  rerender(<Pill tone="done">Done</Pill>);
  expect(screen.getByText('Done').className).toMatch(/bg-success-soft/);
  rerender(<Pill tone="open">Open</Pill>);
  expect(screen.getByText('Open').className).toMatch(/bg-accent-soft/);
  rerender(<Pill tone="neutral">Dropped</Pill>);
  expect(screen.getByText('Dropped').className).toMatch(/bg-muted/);
});
