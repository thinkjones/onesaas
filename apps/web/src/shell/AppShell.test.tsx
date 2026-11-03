import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AppShell from './AppShell.tsx';

function renderShell(opts?: { path?: string; workflows?: unknown[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/api/workflows') {
        return { ok: true, status: 200, json: async () => opts?.workflows ?? [] };
      }
      if (String(input) === '/api/settings') {
        return { ok: true, status: 200, json: async () => ({ onboarded: true }) };
      }
      // TopBar badges: no runs, healthy models.
      if (String(input) === '/api/runs' || String(input) === '/api/models/status') {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }),
  );
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts?.path ?? '/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>page body</p>} />
            <Route path="/automate" element={<p>automate body</p>} />
            <Route path="/reducers/:workflowId" element={<p>reducer body</p>} />
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
    expect(screen.getByRole('link', { name: 'Activity' })).toBeDefined();
    // The TopBar carries an inert data-tauri-drag-region (per §6); only the
    // sidebar strip is Tauri-only.
    expect(container.querySelector('.drag')).toBeNull();
  });

  test('renders a drag strip under the Tauri overlay title bar', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const { container } = renderShell();
    const strip = container.querySelector('[data-tauri-drag-region]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
  });

  test('hides the nav rail on first-time Automate (no chores yet)', async () => {
    renderShell({ path: '/automate', workflows: [] });
    expect(await screen.findByText('automate body')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Activity' })).toBeNull();
  });

  test('shows the nav rail on Automate once a chore exists', async () => {
    renderShell({ path: '/automate', workflows: [{ id: 'wf-1' }] });
    expect(await screen.findByText('automate body')).toBeDefined();
    expect(await screen.findByRole('link', { name: 'Activity' })).toBeDefined();
  });
});

describe('AppShell reducer full bleed', () => {
  test('design mode drops content padding and scroll for the full-bleed canvas', async () => {
    renderShell({ path: '/reducers/wf-1?mode=design' });
    const content = await screen.findByTestId('shell-content');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).not.toContain('px-8');
  });

  test('runtime mode joins the full bleed (Watch-it-Run fills the window)', async () => {
    renderShell({ path: '/reducers/wf-1?mode=runtime' });
    const content = await screen.findByTestId('shell-content');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).not.toContain('px-8');
  });

  test('a bare reducer URL (default runtime) is full bleed too', async () => {
    renderShell({ path: '/reducers/wf-1' });
    const content = await screen.findByTestId('shell-content');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).not.toContain('px-8');
  });

  test('other pages keep the padded scrolling content', async () => {
    renderShell({ path: '/' });
    const content = await screen.findByTestId('shell-content');
    expect(content.className).toContain('overflow-y-auto');
    expect(content.className).toContain('px-8');
  });
});
