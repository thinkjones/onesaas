import type { Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/tooltip.tsx';
import HomePage from '../pages/HomePage.tsx';
import WorkflowPage from '../pages/WorkflowPage.tsx';
import Explain from './Explain.tsx';
import TellMeMoreFallback from './TellMeMoreFallback.tsx';

// TellMeMoreFallback: off the workflow page, Explain's "Tell me more" must
// still open the agent panel with the message sent — never a dead click.
// These drive the REAL chain (Explain popover → window event → fallback →
// router → WorkflowPage → AgentPanel → agent POST), with the fallback
// mounted once at shell level like AppShell does in production.

const EXPLAIN_TEXT = 'Lists are the things your business keeps track of.';

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

// Newest first, like GET /api/workflows (repo.listWorkflows).
const NEWEST = mkWorkflow({ id: 'wf-2', name: 'Newest reducer' });
const OLDER = mkWorkflow({ id: 'wf-1', name: 'Older reducer' });

function LocationProbe({
  onLocation,
}: {
  onLocation: (pathname: string, search: string, state: unknown) => void;
}) {
  const location = useLocation();
  onLocation(location.pathname, location.search, location.state);
  return null;
}

function renderShell(initialPath: string, workflows: Workflow[]) {
  const agentPosts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const ok = (body: unknown, status = 200) =>
      ({ ok: true, status, json: async () => body }) as Response;
    if (url === '/api/workflows' && method === 'GET') return ok(workflows);
    const detail = workflows.find((w) => url === `/api/workflows/${w.id}` && method === 'GET');
    if (detail) return ok({ ...detail, problems: [] });
    const agentGet = workflows.find(
      (w) => url === `/api/workflows/${w.id}/agent` && method === 'GET',
    );
    if (agentGet) return ok([]);
    const agentPost = workflows.find(
      (w) => url === `/api/workflows/${w.id}/agent` && method === 'POST',
    );
    if (agentPost) {
      agentPosts.push(JSON.parse(String(init?.body)) as unknown);
      return ok({}, 202);
    }
    if (url === '/api/explain' && method === 'POST') return ok({ text: EXPLAIN_TEXT });
    if (url === '/api/runs') return ok([]);
    if (url === '/api/views') return ok([]);
    if (url === '/api/lists') return ok([]);
    // Full shape: DesignView's useSound reads settings.sound.
    if (url === '/api/settings')
      return ok({
        timezone: 'America/New_York',
        theme: 'morning',
        textSize: 'normal',
        sound: { on: false, volume: 0.5 },
        onboarded: true,
        moodFileIds: [],
      });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let pathname = initialPath;
  let search = '';
  let state: unknown = null;
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <TellMeMoreFallback />
          <LocationProbe
            onLocation={(p, s, st) => {
              pathname = p;
              search = s;
              state = st;
            }}
          />
          <Routes>
            <Route
              path="/lists"
              element={<Explain target={{ kind: 'column', id: 'email', context: 'customers' }} label="Email" />}
            />
            <Route
              path="/settings"
              element={<Explain target={{ kind: 'ui', id: 'nav-settings' }} label="Settings" />}
            />
            <Route path="/reducers/:workflowId" element={<WorkflowPage />} />
            {/* Home carries a NavRail-style Explain (AppShell-level in production). */}
            <Route
              path="/"
              element={
                <>
                  <HomePage />
                  <Explain target={{ kind: 'ui', id: 'nav-home' }} label="Home" />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { agentPosts, location: () => ({ pathname, search, state }) };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TellMeMoreFallback', () => {
  test('off-workflow "Tell me more" opens the most-recent reducer and sends the message', async () => {
    const { agentPosts, location } = renderShell('/lists', [NEWEST, OLDER]);
    // A Lists column-header Explain, clicked for real: ? opens the popover…
    fireEvent.click(screen.getByRole('button', { name: 'Explain Email' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    // …"Tell me more" routes to the newest reducer's design page…
    fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));
    await waitFor(() => {
      expect(location().pathname).toBe('/reducers/wf-2');
    });
    expect(location().search).toBe('?mode=design');
    // …and the real panel sends through the opening-send path (the consumed
    // history entry plus the POST prove it — the location state itself is
    // wiped on consume, by design).
    await screen.findByText('Tell me more about Email');
    expect(agentPosts).toEqual([{ text: 'Tell me more about Email' }]);
    await waitFor(() => {
      expect(location().state).toEqual({});
    });
  });

  test('with no reducers yet, "Tell me more" lands Home with the message in the box', async () => {
    const { location } = renderShell('/settings', []);
    fireEvent.click(screen.getByRole('button', { name: 'Explain Settings' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));
    await waitFor(() => {
      expect(location().pathname).toBe('/');
    });
    expect(location().state).toEqual({ homePrefill: 'Tell me more about Settings' });
    const box = (await screen.findByRole('textbox', {
      name: 'What do you want to achieve today?',
    })) as HTMLTextAreaElement;
    expect(box.value).toBe('Tell me more about Settings');
  });

  test('already Home with no reducers, "Tell me more" still fills the box (no remount)', async () => {
    renderShell('/', []);
    fireEvent.click(screen.getByRole('button', { name: 'Explain Home' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));
    // Same-path re-navigation: the prefill lands without a remount…
    const box = (await screen.findByRole('textbox', {
      name: 'What do you want to achieve today?',
    })) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(box.value).toBe('Tell me more about Home');
    });
    // …and typing afterwards is never clobbered by a re-applied prefill.
    fireEvent.change(box, { target: { value: 'Dad typing' } });
    expect(box.value).toBe('Dad typing');
  });

  test('on a workflow page the fallback stays out of the way (no navigation, one direct send)', async () => {
    const { agentPosts, location } = renderShell('/reducers/wf-1?mode=design', [OLDER]);
    // The page's own panel is up…
    expect(
      await screen.findByRole('textbox', { name: 'Message the helper' }),
    ).toBeDefined();
    // …and a tell-me-more from the page sends directly without navigating.
    window.dispatchEvent(
      new CustomEvent('dad:tell-me-more', { detail: { message: 'Tell me more about Write reply' } }),
    );
    await screen.findByText('Tell me more about Write reply');
    expect(agentPosts).toEqual([{ text: 'Tell me more about Write reply' }]);
    expect(location().pathname).toBe('/reducers/wf-1');
  });
});
