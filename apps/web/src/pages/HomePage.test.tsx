import { POPULAR_IDEA_IDS, STARTER_IDEAS, type Run, type Workflow } from '@onesaas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Toaster, toast } from 'sonner';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import HomePage from './HomePage.tsx';

const SENTENCE = 'When a customer emails me, save them and draft a reply for me to check';
const HEADING = 'What chore should I take off your hands?';

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
            path="/automations/:workflowId"
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
  const box = () => screen.getByRole('textbox', { name: 'Describe the chore' }) as HTMLTextAreaElement;
  const ideaTitles = () =>
    [...document.querySelectorAll('.idea-title')].map((el) => el.textContent);

  test('with no automations it shows the setup box only, with no Add new', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: HEADING })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Add new' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your automations' })).toBeNull();
  });

  test('with automations it shows the header and cards, and hides the setup box', async () => {
    renderHome({ workflows: [mkWorkflow()] });
    expect(await screen.findByRole('region', { name: 'Your automations' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Automations · 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add new' })).toBeDefined();
    expect(screen.queryByRole('textbox', { name: 'Describe the chore' })).toBeNull();
    expect(await screen.findByText('All ticking along.')).toBeDefined();
  });

  test('Add new opens the box with focus; Not now and Escape close it', async () => {
    renderHome({ workflows: [mkWorkflow()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Add new' }));
    expect(
      screen.getByRole('heading', { name: 'What else should I take off your hands?' }),
    ).toBeDefined();
    expect(document.activeElement).toBe(box());
    expect(screen.getByRole('heading', { name: 'Your automations · 1' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Describe the chore' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add new' }));
    expect(box()).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Add new' })).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Describe the chore' })).toBeNull();
    });
  });

  test('chips switch the ideas: Popular in its set order, stages by count', async () => {
    renderHome();
    await screen.findByRole('heading', { name: HEADING });
    const chips = within(screen.getByRole('group', { name: 'Filter ideas' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toEqual([
      'Popular · 8',
      'Win the job · 4',
      'Do the job · 5',
      'Get paid · 4',
      'Keep customers · 4',
      'Run the shop · 3',
    ]);
    const byId = POPULAR_IDEA_IDS.map((id) => STARTER_IDEAS.find((i) => i.id === id)!.title);
    expect(ideaTitles()).toEqual(byId);

    const runShop = screen.getByRole('button', { name: 'Run the shop · 3' });
    fireEvent.click(runShop);
    expect(runShop.getAttribute('aria-pressed')).toBe('true');
    expect(ideaTitles()).toEqual(STARTER_IDEAS.filter((i) => i.stage === 'run').map((i) => i.title));
  });

  test('picking an idea fills the box and selects it, without building', async () => {
    const { posts } = renderHome();
    await screen.findByRole('heading', { name: HEADING });
    const card = screen.getByRole('button', { name: 'Text back missed calls' });
    fireEvent.click(card);
    expect(box().value).toBe('When I miss a call, text them back straight away and find out what they need.');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Starting from “Text back missed calls”. Change any words you like.')).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(box());
    });
    expect(posts).toHaveLength(0);
  });

  test('an empty start prompts inline without POSTing', async () => {
    const { posts } = renderHome();
    await screen.findByRole('heading', { name: HEADING });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText('Tell me what you want to achieve first.')).toBeDefined();
    expect(posts).toHaveLength(0);
  });

  test('a sentence creates an automation named from its first 6 words and opens it with the opening send', async () => {
    const { posts, location } = renderHome();
    await screen.findByRole('heading', { name: HEADING });
    fireEvent.change(box(), { target: { value: SENTENCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    await waitFor(() => {
      expect(posts).toEqual([{ name: 'When a customer emails me, save', description: SENTENCE }]);
    });
    await waitFor(() => {
      expect(location().pathname).toBe('/automations/wf-new');
    });
    expect(location().search).toBe('?mode=design');
    expect(location().state).toEqual({ agentPrompt: SENTENCE });
  });

  test('a failed create shows an inline error and stays here', async () => {
    const { location } = renderHome({ failCreate: true });
    await screen.findByRole('heading', { name: HEADING });
    fireEvent.change(box(), { target: { value: SENTENCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
    expect(await screen.findByText("Couldn't create an automation. Try again.")).toBeDefined();
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
    await screen.findByRole('heading', { name: HEADING });
    fireEvent.click(screen.getByRole('button', { name: 'Send first prefill' }));
    expect(box().value).toBe('First prefill');
    fireEvent.click(screen.getByRole('button', { name: 'Send second prefill' }));
    expect(box().value).toBe('Second prefill');
  });

  test("a prefill arriving after the owner typed doesn't clobber the box", async () => {
    renderHome({}, { prefillProbe: true });
    await screen.findByRole('heading', { name: HEADING });
    fireEvent.change(box(), { target: { value: 'The owner typing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send first prefill' }));
    expect(box().value).toBe('The owner typing');
  });

  test('a prefill opens the box when automations hide it', async () => {
    renderHome({ workflows: [mkWorkflow()] }, { prefillProbe: true });
    await screen.findByRole('button', { name: 'Add new' });
    fireEvent.click(screen.getByRole('button', { name: 'Send first prefill' }));
    expect(box().value).toBe('First prefill');
  });

  test('cards that need you come first, are ringed, and link to the run', async () => {
    renderHome({
      workflows: [
        mkWorkflow({ id: 'wf-ok', name: 'All fine' }),
        mkWorkflow({ id: 'wf-bad', name: 'Went wrong' }),
        mkWorkflow({ id: 'wf-wait', name: 'Wants a check' }),
      ],
      runs: [
        mkRun({ id: 'r1', workflowId: 'wf-ok', status: 'done' }),
        mkRun({ id: 'r2', workflowId: 'wf-bad', status: 'failed' }),
        mkRun({ id: 'old', workflowId: 'wf-wait', status: 'waiting', startedAt: '2026-10-28T09:00:00.000Z' }),
        mkRun({ id: 'newer', workflowId: 'wf-wait', status: 'done', startedAt: '2026-10-28T13:00:00.000Z' }),
      ],
    });
    expect(await screen.findByText('Two need you. The rest are ticking along.')).toBeDefined();
    const cards = await waitFor(() => {
      const found = [...document.querySelectorAll('.automation-card')];
      expect(found[0]?.getAttribute('data-needs')).toBe('waiting');
      return found;
    });
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Wants a check', 'Went wrong', 'All fine']);
    expect(cards[1]!.getAttribute('data-needs')).toBe('failed');
    expect(cards[2]!.getAttribute('data-needs')).toBeNull();
    const waiting = screen.getByRole('link', { name: 'Waiting for you' });
    expect(waiting.getAttribute('href')).toBe('/automations/wf-wait?mode=runs&run=old');
  });

  test('a card with no runs says so, and long flows collapse into +N', async () => {
    const step = (id: string) => ({ ...mkWorkflow().trigger, id, type: 'notify' as const });
    renderHome({
      workflows: [
        mkWorkflow({ steps: ['a', 'b', 'c', 'd', 'e', 'f'].map(step), status: 'off' }),
      ],
    });
    expect(await screen.findByText('Not run yet · 6 steps')).toBeDefined();
    expect(screen.getByText('Off')).toBeDefined();
    expect(screen.getByText('+2')).toBeDefined();
  });

  test('a card name opens the automation in design mode', async () => {
    renderHome({ workflows: [mkWorkflow()], runs: [mkRun({})] });
    const name = await screen.findByRole('link', { name: 'Email helper' });
    expect(name.getAttribute('href')).toBe('/automations/wf-1?mode=design');
  });
});
