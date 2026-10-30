import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import HomePage from './HomePage.tsx';

const SENTENCE = 'When a customer emails me, save them and draft a reply for me to check';

function LocationProbe({
  onLocation,
}: {
  onLocation: (pathname: string, search: string, state: unknown) => void;
}) {
  const location = useLocation();
  onLocation(location.pathname, location.search, location.state);
  return null;
}

function renderHome(opts?: { failCreate?: boolean }) {
  const posts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/workflows' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as unknown;
      posts.push(body);
      if (opts?.failCreate) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: 'boom' }),
          json: async () => ({ error: 'boom' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: 'wf-new', name: 'x' }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let pathname = '/';
  let search = '';
  let state: unknown = null;
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/reducers/:workflowId"
            element={
              <LocationProbe
                onLocation={(p, s, st) => {
                  pathname = p;
                  search = s;
                  state = st;
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { posts, location: () => ({ pathname, search, state }) };
}

function sentenceBox(): HTMLElement {
  return screen.getByRole('textbox', { name: 'What do you want to achieve today?' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  test('points new users at connecting Gmail in Settings', () => {
    renderHome();
    const link = screen.getByRole('link', { name: /connect gmail in settings/i });
    expect(link.getAttribute('href')).toBe('/settings');
  });

  test('an empty start prompts inline without POSTing', async () => {
    const { posts } = renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText('Tell me what you want to achieve first.')).toBeDefined();
    expect(posts).toHaveLength(0);
  });

  test('a sentence creates a reducer named from its first 6 words and opens it with the opening send', async () => {
    const { posts, location } = renderHome();
    fireEvent.change(sentenceBox(), { target: { value: SENTENCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    await waitFor(() => {
      expect(posts).toEqual([
        { name: 'When a customer emails me, save', description: SENTENCE },
      ]);
    });
    await waitFor(() => {
      expect(location().pathname).toBe('/reducers/wf-new');
    });
    expect(location().search).toBe('?mode=design');
    expect(location().state).toEqual({ agentPrompt: SENTENCE });
  });

  test('a failed create shows an inline error and stays home', async () => {
    const { location } = renderHome({ failCreate: true });
    fireEvent.change(sentenceBox(), { target: { value: SENTENCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText("Couldn't create a chore reducer. Try again.")).toBeDefined();
    expect(location().pathname).toBe('/');
  });
});
