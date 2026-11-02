import type { Run, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Toaster, toast } from 'sonner';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import HomePage from './HomePage.tsx';

// The Automate screen: the centred prompt, mic + text box + suggestions,
// and — once a chore exists — the "Your chore reducers" cards underneath.

const SENTENCE = 'When a customer emails me, save them and draft a reply for me to check';

const SUGGESTIONS = [
  'Answer customer emails faster',
  'Keep track of bookings',
  'Turn a photo into a post',
  'Show me how my week went',
];

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

/** Same-path re-navigation with a new homePrefill, like TellMeMoreFallback fires. */
function PrefillProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/', { state: { homePrefill: 'First prefill' } })}>
        Send first prefill
      </button>
      <button type="button" onClick={() => navigate('/', { state: { homePrefill: 'Second prefill' } })}>
        Send second prefill
      </button>
    </>
  );
}

function renderHome(data?: StubData, opts?: { prefillProbe?: boolean }) {
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
    if (url === '/api/settings') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ timezone: 'America/New_York' }),
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
        <Toaster />
        <Routes>
          <Route
            path="/"
            element={opts?.prefillProbe ? (<><HomePage /><PrefillProbe /></>) : (<HomePage />)}
          />
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

beforeEach(() => {
  // Sonner's toast store is module-global: a previous test's still-alive
  // toast would re-render in the next test's fresh Toaster.
  toast.dismiss();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  test('with no chores yet it shows the pure prompt and suggestions, no reducer cards', async () => {
    renderHome();
    expect(
      await screen.findByRole('heading', { name: 'What do you want to achieve today?' }),
    ).toBeDefined();
    for (const title of SUGGESTIONS) {
      expect(screen.getByRole('button', { name: title })).toBeDefined();
    }
    expect(screen.queryByRole('heading', { name: 'Your chore reducers' })).toBeNull();
    expect(screen.queryByText(/business at a glance/i)).toBeNull();
  });

  test('with chores it shows the prompt plus the reducer cards underneath', async () => {
    renderHome({ workflows: [mkWorkflow()] });
    expect(
      await screen.findByRole('heading', { name: 'What do you want to achieve today?' }),
    ).toBeDefined();
    expect(
      await screen.findByRole('heading', { name: 'Your chore reducers · 1' }),
    ).toBeDefined();
  });

  test('clicking a suggestion fills the box without submitting', async () => {
    const { posts } = renderHome();
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
        fireEvent.click(screen.getByRole('button', { name: 'Keep track of bookings' }));
    expect((sentenceBox() as HTMLTextAreaElement).value).toBe('Keep track of bookings');
    expect(posts).toHaveLength(0);
    // Let the background queries settle so nothing leaks past the test.
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
  });

  test('an empty start prompts inline without POSTing', async () => {
    const { posts } = renderHome();
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
        fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText('Tell me what you want to achieve first.')).toBeDefined();
    expect(posts).toHaveLength(0);
  });

  test('a sentence creates a reducer named from its first 6 words and opens it with the opening send', async () => {
    const { posts, location } = renderHome();
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
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
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
        fireEvent.change(sentenceBox(), { target: { value: SENTENCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText("Couldn't create a chore reducer. Try again.")).toBeDefined();
    expect(location().pathname).toBe('/');
  });

  test('a toggle whose save fails shows a plain-words error instead of failing silently', async () => {
    // The ops route is unstubbed, so the save rejects like a network failure.
    renderHome({ workflows: [mkWorkflow()] });
    fireEvent.click(await screen.findByRole('switch', { name: 'Email helper enabled' }));
    expect(await screen.findByText("Couldn't reach the server. Try again.")).toBeDefined();
  });

  test('a fresh prefill replaces an untouched prefill', async () => {
    renderHome({}, { prefillProbe: true });
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
        fireEvent.click(screen.getByRole('button', { name: 'Send first prefill' }));
    expect((sentenceBox() as HTMLTextAreaElement).value).toBe('First prefill');
    fireEvent.click(screen.getByRole('button', { name: 'Send second prefill' }));
    expect((sentenceBox() as HTMLTextAreaElement).value).toBe('Second prefill');
    // Let the background queries settle so nothing leaks past the test.
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
  });

  test("a prefill arriving after Dad typed doesn't clobber the box", async () => {
    renderHome({}, { prefillProbe: true });
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
        fireEvent.change(sentenceBox(), { target: { value: 'Dad typing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send first prefill' }));
    expect((sentenceBox() as HTMLTextAreaElement).value).toBe('Dad typing');
    // Let the background queries settle so nothing leaks past the test.
    await screen.findByRole('heading', { name: 'What do you want to achieve today?' });
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

});
