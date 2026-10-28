import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import HomePage from './HomePage.tsx';

test('points new users at connecting Gmail in Settings', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: /connect gmail in settings/i });
  expect(link.getAttribute('href')).toBe('/settings');
});
