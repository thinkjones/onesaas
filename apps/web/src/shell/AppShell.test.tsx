import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AppShell from './AppShell.tsx';
import BarActions from './BarActions.tsx';

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
      // Bar badges: no runs, healthy models; no tables.
      if (['/api/runs', '/api/models/status', '/api/lists'].includes(String(input))) {
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
            <Route path="/reducers/:workflowId" element={
              <>
                <p>reducer body</p>
                <BarActions>
                  <button type="button">Screen action</button>
                </BarActions>
              </>
            } />
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
  test('the floating bar is the only navigation, on every screen', async () => {
    renderShell({ path: '/automate', workflows: [] });
    expect(await screen.findByText('automate body')).toBeDefined();
    const bar = screen.getByTestId('floating-bar');
    for (const name of ['Activity', 'Automate', 'Data']) {
      expect(within(bar).getByRole('link', { name })).toBeDefined();
    }
    expect(within(bar).getByRole('link', { name: 'Settings' })).toBeDefined();
  });

  test('Alt+number travels between the three modes, but not while typing', async () => {
    renderShell({ path: '/', workflows: [] });
    expect(await screen.findByText('page body')).toBeDefined();
    fireEvent.keyDown(window, { altKey: true, code: 'Digit2' });
    expect(await screen.findByText('automate body')).toBeDefined();
    const input = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(input, { altKey: true, code: 'Digit1' });
    expect(screen.queryByText('page body')).toBeNull();
    input.remove();
  });

  test('the picker lists automations in Automate and opens the chosen one', async () => {
    renderShell({ path: '/automate', workflows: [{ id: 'wf-1', name: 'Leads' }] });
    const picker = await screen.findByRole('combobox', { name: 'Choose an automation' });
    fireEvent.change(picker, { target: { value: 'wf-1' } });
    expect(await screen.findByText('reducer body')).toBeDefined();
  });

  test('a screen can place its actions in the bar', async () => {
    renderShell({ path: '/reducers/wf-1?mode=design', workflows: [] });
    const button = await screen.findByRole('button', { name: 'Screen action' });
    expect(screen.getByTestId('floating-bar').contains(button)).toBe(true);
  });

  test('an automation canvas fills the board; other screens scroll beneath the bar', async () => {
    const { unmount } = renderShell({ path: '/reducers/wf-1?mode=design' });
    expect((await screen.findByTestId('shell-content')).className).toContain('overflow-hidden');
    unmount();
    renderShell({ path: '/' });
    const content = await screen.findByTestId('shell-content');
    expect(content.className).toContain('overflow-y-auto');
    expect(content.className).toContain('pt-20');
  });

  test('the drag strip only appears under the Tauri overlay title bar', () => {
    const { container, unmount } = renderShell();
    expect(container.querySelector('div[data-tauri-drag-region]')).toBeNull();
    unmount();
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const tauri = renderShell();
    expect(tauri.container.querySelector('div[data-tauri-drag-region]')).not.toBeNull();
  });
});
