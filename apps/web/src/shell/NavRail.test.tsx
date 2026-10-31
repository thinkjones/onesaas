import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import NavRail from './NavRail.tsx';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavRail />
    </MemoryRouter>,
  );
}

describe('NavRail', () => {
  test('renders links Inbox, Automate, Data, Settings', () => {
    renderAt('/');
    for (const name of ['Inbox', 'Automate', 'Data', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeDefined();
    }
  });

  test('active route has aria-current="page"', () => {
    renderAt('/lists');
    expect(screen.getByRole('link', { name: 'Data' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBeNull();
  });

  test('each link is at least 40px tall', () => {
    renderAt('/');
    for (const name of ['Inbox', 'Automate', 'Data', 'Settings']) {
      expect(screen.getByRole('link', { name }).classList.contains('min-h-10')).toBe(true);
    }
  });
});
