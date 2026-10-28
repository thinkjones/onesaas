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
  test('renders links Home, Chore reducers, Lists, Settings', () => {
    renderAt('/');
    for (const name of ['Home', 'Chore reducers', 'Lists', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeDefined();
    }
  });

  test('active route has aria-current="page"', () => {
    renderAt('/lists');
    expect(screen.getByRole('link', { name: 'Lists' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  test('each link is at least 40px tall', () => {
    renderAt('/');
    for (const name of ['Home', 'Chore reducers', 'Lists', 'Settings']) {
      expect(screen.getByRole('link', { name }).classList.contains('min-h-10')).toBe(true);
    }
  });
});
