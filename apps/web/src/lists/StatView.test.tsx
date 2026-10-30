import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StatView from './StatView.tsx';

describe('StatView', () => {
  test('renders the value large with the title', () => {
    render(<StatView title="New customers this week" value={12} />);
    expect(screen.getByText('New customers this week')).toBeDefined();
    const value = screen.getByText('12');
    expect(value.className).toMatch(/text-5xl/);
  });
});
