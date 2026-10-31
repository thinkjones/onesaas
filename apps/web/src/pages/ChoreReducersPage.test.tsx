import type { StepInstance, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ChoreReducersPage, { UNTITLED_CHORE_REDUCER } from './ChoreReducersPage.tsx';

const TRIGGER: StepInstance = {
  id: 'trigger',
  type: 'trigger.manual',
  title: 'Manual trigger',
  summary: 'Runs when you start it by hand.',
  config: {},
  inputs: {},
  position: { x: 100, y: 100 },
};

function workflow(): Workflow {
  return {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'off',
    trigger: TRIGGER,
    steps: [],
    edges: [],
  };
}

function LocationProbe({ onLocation }: { onLocation: (pathname: string, search: string) => void }) {
  const location = useLocation();
  onLocation(location.pathname, location.search);
  return null;
}

function renderList() {
  const posts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = async () => {
      if (url === '/api/workflows' && init?.method !== 'POST') return [workflow()];
      if (url === '/api/runs?workflowId=flow-1') return [];
      if (url === '/api/workflows' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as unknown;
        posts.push(body);
        return { ...workflow(), id: 'wf-new', name: UNTITLED_CHORE_REDUCER, description: '' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 200, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let pathname = '/reducers';
  let search = '';
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reducers']}>
        <Routes>
          <Route path="/reducers" element={<ChoreReducersPage />} />
          <Route
            path="/reducers/:workflowId"
            element={
              <LocationProbe
                onLocation={(p, s) => {
                  pathname = p;
                  search = s;
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { posts, location: () => ({ pathname, search }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChoreReducersPage click through', () => {
  test('clicking a reducer name opens its details page', async () => {
    const { location } = renderList();
    fireEvent.click(await screen.findByRole('link', { name: 'Test flow' }));
    await waitFor(() => {
      expect(location().pathname).toBe('/reducers/flow-1');
    });
  });
});

describe('ChoreReducersPage new reducer', () => {
  test('"New chore reducer" creates a blank reducer and opens it in design mode', async () => {
    const { posts, location } = renderList();
    expect(await screen.findByText('Test flow')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'New chore reducer' }));
    await waitFor(() => {
      expect(posts).toEqual([{ name: 'Untitled chore reducer', description: '' }]);
    });
    await waitFor(() => {
      expect(location().pathname).toBe('/reducers/wf-new');
    });
    expect(location().search).toBe('?mode=design');
  });
});
