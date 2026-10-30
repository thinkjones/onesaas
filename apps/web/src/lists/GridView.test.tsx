import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import GridView from './GridView.tsx';
import type { ListTable } from './types.ts';

const TABLE: ListTable = {
  name: 'customers',
  label: 'Customers',
  columns: [
    { name: 'first_name', label: 'First Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
  ],
  displayField: 'first_name',
};

describe('GridView', () => {
  test('renders column labels, not sanitised names', () => {
    render(
      <GridView
        table={TABLE}
        rows={[{ id: 1, first_name: 'Sarah', email: 'sarah@x.com' }]}
        timezone={null}
      />,
    );
    expect(screen.getByText('First Name')).toBeDefined();
    expect(screen.getByText('Email')).toBeDefined();
    expect(screen.queryByText('first_name')).toBeNull();
    expect(screen.getByText('Sarah')).toBeDefined();
  });
});
