import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AppShell from './AppShell.tsx';

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>page body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no fetch in shell test');
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
});

describe('AppShell', () => {
  test('renders nav and page with no desktop drag strip in a browser', () => {
    const { container } = renderShell();
    expect(screen.getByText('page body')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeDefined();
    expect(container.querySelector('[data-tauri-drag-region]')).toBeNull();
  });

  test('renders a drag strip under the Tauri overlay title bar', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const { container } = renderShell();
    const strip = container.querySelector('[data-tauri-drag-region]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
  });
});
