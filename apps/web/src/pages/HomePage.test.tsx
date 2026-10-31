import type { Run, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ListSummary } from '../lists/types.ts';
import HomePage from './HomePage.tsx';

// M5 Task 6: the home screen — the centred prompt, mic + text box +
// suggestions, "Your chore reducers" cards, and "Your business at a glance".

const SENTENCE = 'When a customer emails me, save them and draft a reply for me to check';

const SUGGESTIONS = [
  'Answer customer emails faster',
  'Keep track of bookings',
  'Turn a photo into a post',
  'Show me how my week went',
];

const EMPTY_GLANCE = "Ask me to keep an eye on something, like 'how many new customers this week?'";

function mkWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'wf-1',
    name: 'Email helper',
    description: 'Help with customer email.',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.email',
      title: 'New email',
      summary: 'Runs when email arrives.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [],
    edges: [],
    ...overrides,
  };
}

function mkRun(overrides?: Partial<Run>): Run {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

interface StubData {
  workflows?: Workflow[];
  runs?: Run[];
  views?: unknown[];
  lists?: ListSummary[];
  viewData?: Record<string, unknown>;
  failCreate?: boolean;
}

function LocationProbe({
  onLocation,
}: {
  onLocation: (pathname: string, search: string, state: unknown) => void;
}) {
  const location = useLocation();
  onLocation(location.pathname, location.search, location.state);
  return null;
}

function renderHome(data?: StubData) {
  const posts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/workflows' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as unknown;
      posts.push(body);
      if (data?.failCreate) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: 'boom' }),
          json: async () => ({ error: 'boom' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: 'wf-new', name: 'x' }) } as Response;
    }
    if (url === '/api/workflows') {
      return { ok: true, status: 200, json: async () => data?.workflows ?? [] } as Response;
    }
    if (url === '/api/runs') {
      return { ok: true, status: 200, json: async () => data?.runs ?? [] } as Response;
    }
    if (url === '/api/views') {
      return { ok: true, status: 200, json: async () => data?.views ?? [] } as Response;
    }
    if (url === '/api/lists') {
      return { ok: true, status: 200, json: async () => data?.lists ?? [] } as Response;
    }
    if (url === '/api/settings') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ timezone: 'America/New_York' }),
      } as Response;
    }
    if (url.startsWith('/api/views/') && url.endsWith('/data')) {
      const id = url.slice('/api/views/'.length, -'/data'.length);
      return {
        ok: true,
        status: 200,
        json: async () => data?.viewData?.[id] ?? { value: 0 },
      } as Response;
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
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
  test('renders the exact prompt, four suggestions, and the empty at-a-glance hint', async () => {
    renderHome();
    expect(
      screen.getByRole('heading', { name: 'What do you want to achieve today?' }),
    ).toBeDefined();
    for (const title of SUGGESTIONS) {
      expect(screen.getByRole('button', { name: title })).toBeDefined();
    }
    expect(await screen.findByText(EMPTY_GLANCE)).toBeDefined();
  });

  test('clicking a suggestion fills the box without submitting', async () => {
    const { posts } = renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Keep track of bookings' }));
    expect((sentenceBox() as HTMLTextAreaElement).value).toBe('Keep track of bookings');
    expect(posts).toHaveLength(0);
    // Let the background queries settle so nothing leaks past the test.
    await screen.findByText(EMPTY_GLANCE);
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

  test('a reducer card shows "N waiting for you" linking to the oldest waiting run', async () => {
    renderHome({
      workflows: [mkWorkflow()],
      runs: [
        mkRun({ id: 'run-new', status: 'waiting', startedAt: '2026-10-28T12:00:00.000Z' }),
        mkRun({ id: 'run-old', status: 'waiting', startedAt: '2026-10-28T09:00:00.000Z' }),
        mkRun({ id: 'run-done', status: 'done', startedAt: '2026-10-28T13:00:00.000Z' }),
      ],
    });
    const badge = await screen.findByRole('link', { name: '2 waiting for you' });
    expect(badge.getAttribute('href')).toBe('/reducers/wf-1?run=run-old');
  });

  test('a pinned view renders its value instead of the empty hint', async () => {
    renderHome({
      views: [
        {
          id: 'v1',
          table: 'customers',
          kind: 'stat',
          title: 'New customers',
          pinned: true,
          config: { stat: { op: 'count' } },
        },
      ],
      lists: [
        {
          name: 'customers',
          label: 'Customers',
          columns: [{ name: 'name', label: 'Name', type: 'text' }],
          displayField: 'name',
          count: 2,
        },
      ],
      viewData: { v1: { value: 5 } },
    });
    expect(await screen.findByText('New customers')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.queryByText(EMPTY_GLANCE)).toBeNull();
  });
});
