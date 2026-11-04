import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, test, vi } from 'vitest';
import AppButton from './AppButton.tsx';
import EmptyState from './EmptyState.tsx';
import StatusBadge from './StatusBadge.tsx';

// Global Constraints status language. NOTE: "Working…" uses U+2026 ELLIPSIS,
// not three full stops — match it byte-exact.
const CASES = [
  ['pending', 'Not started'],
  ['running', 'Working…'],
  ['waiting', 'Waiting for you'],
  ['done', 'Done'],
  ['failed', 'Needs a look'],
  ['skipped', 'Skipped'],
] as const;

describe('StatusBadge', () => {
  for (const [status, label] of CASES) {
    test(`renders "${label}" for ${status} with matching data-status`, () => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByText(label);
      expect(badge.getAttribute('data-status')).toBe(status);
    });
  }

  test('running pulses, skipped uses a dashed border', () => {
    const { rerender } = render(<StatusBadge status="running" />);
    expect(screen.getByText('Working…').className).toMatch(/animate-pulse/);
    rerender(<StatusBadge status="skipped" />);
    expect(screen.getByText('Skipped').className).toMatch(/border-dashed/);
  });
});

describe('AppButton', () => {
  test('full-size buttons are at least 40px tall', () => {
    render(<AppButton>Do it</AppButton>);
    const button = screen.getByRole('button', { name: 'Do it' });
    expect(button.classList.contains('min-h-10')).toBe(true);
  });
});

describe('EmptyState', () => {
  test('renders title, hint and action label', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="No runs yet"
        hint="Runs will show up here once this chore reducer starts."
        action={{ label: 'Run now', onClick }}
      />,
    );
    expect(screen.getByText('No runs yet')).toBeDefined();
    expect(screen.getByText('Runs will show up here once this chore reducer starts.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDefined();
  });
});
