import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgentTranscriptEntry } from '../api.ts';
import AgentPanel, { type AgentPanelProps } from './AgentPanel.tsx';
import { AGENT_SETTLING_MS, useAgent, workflowNameFromSentence } from './useAgent.ts';

// The page owns the conversation (Bug #4); the wrapper calls the real hook
// so the fetch-stub harness keeps driving honest behavior.
function PanelWithAgent(props: Omit<AgentPanelProps, 'agent'>) {
  const agent = useAgent('flow-1');
  return <AgentPanel {...props} agent={agent} />;
}

// Captures EventSource subscribers so tests can deliver agent events.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {}
}

function emitAgent(workflowId: string, event: unknown): void {
  const data = JSON.stringify({ type: 'agent', workflowId, event });
  for (const inst of FakeEventSource.instances) inst.onmessage?.({ data });
}

interface StubResponse {
  status: number;
  body: unknown;
}

function renderPanel(opts?: {
  transcript?: AgentTranscriptEntry[];
  agentPost?: (body: { text: string }) => StubResponse;
  failPost?: boolean;
  failGet?: boolean;
  getGate?: Promise<void>;
  prefill?: string;
  onPrefillConsumed?: () => void;
  initialPrompt?: string;
  onInitialSent?: () => void;
  onCollapse?: () => void;
}) {
  const posts: { text: string }[] = [];
  let getCount = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/workflows/flow-1/agent' && init?.method !== 'POST') {
      getCount += 1;
      if (opts?.failGet) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: 'boom' }),
        } as Response;
      }
      if (opts?.getGate) await opts.getGate;
      const body = opts?.transcript ?? [];
      return { ok: true, status: 200, json: async () => body } as Response;
    }
    if (url === '/api/workflows/flow-1/agent' && init?.method === 'POST') {
      if (opts?.failPost) throw new Error('offline');
      const body = JSON.parse(String(init.body)) as { text: string };
      posts.push(body);
      const res = opts?.agentPost?.(body) ?? { status: 202, body: {} };
      const text = JSON.stringify(res.body);
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: async () => text,
        json: async () => res.body,
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <PanelWithAgent
        prefill={opts?.prefill}
        onPrefillConsumed={opts?.onPrefillConsumed}
        initialPrompt={opts?.initialPrompt}
        onInitialSent={opts?.onInitialSent}
        onCollapse={opts?.onCollapse}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, fetch, posts, getCount: () => getCount, client };
}

function textarea(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Chat message' });
}

const PERSISTED: AgentTranscriptEntry[] = [
  { role: 'dad', text: 'Save my customers', at: 1 },
  { role: 'agent', text: 'On it.', at: 2 },
];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AgentPanel transcript', () => {
  test('shows the persisted transcript on mount', async () => {
    renderPanel({ transcript: PERSISTED });
    expect(await screen.findByText('Save my customers')).toBeDefined();
    expect(screen.getByText('On it.')).toBeDefined();
  });

  test('live say events append without duplicating the persisted rows', async () => {
    renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    act(() => emitAgent('flow-1', { type: 'say', text: 'Still working on it.' }));
    expect(await screen.findByText('Still working on it.')).toBeDefined();
    expect(screen.getAllByText('On it.')).toHaveLength(1);
    expect(screen.getAllByText('Save my customers')).toHaveLength(1);
  });

  test('the transcript is fetched once: no refetch when a turn ends', async () => {
    const { getCount } = renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    expect(getCount()).toBe(1);
    try {
      vi.useFakeTimers();
      act(() => emitAgent('flow-1', { type: 'done' }));
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS + 100);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(getCount()).toBe(1);
  });

  test('an empty transcript shows a plain-words hint', async () => {
    renderPanel({ transcript: [] });
    expect(await screen.findByText('Tell me what you want this chore reducer to do.')).toBeDefined();
  });
});

describe('AgentPanel ask chips', () => {
  const ASK = { type: 'ask', question: 'Which inbox should I watch?', options: ['Gmail', 'Outlook', 'Something else'] };

  test('renders 3 chips for an ask with 3 options', async () => {
    renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    act(() => emitAgent('flow-1', ASK));
    expect(await screen.findByText('Which inbox should I watch?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Gmail' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Outlook' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Something else' })).toBeDefined();
  });

  test('clicking a chip sends its text as a Dad message', async () => {
    const { posts } = renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    act(() => emitAgent('flow-1', ASK));
    fireEvent.click(await screen.findByRole('button', { name: 'Outlook' }));
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'Outlook' }]);
    });
    // The clicked chip lands in the transcript as Dad's own message.
    expect(screen.getAllByText('Outlook')).toHaveLength(2);
  });

  test('only the latest ask has clickable chips', async () => {
    const { posts } = renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    act(() => emitAgent('flow-1', { type: 'ask', question: 'First?', options: ['A1', 'A2'] }));
    await screen.findByText('First?');
    act(() => emitAgent('flow-1', { type: 'ask', question: 'Second?', options: ['B1', 'B2'] }));
    await screen.findByText('Second?');
    expect((screen.getByRole('button', { name: 'A1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'A2' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'B1' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'B1' }));
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'B1' }]);
    });
  });

  test('chips are disabled while busy', async () => {
    renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
    });
    act(() => emitAgent('flow-1', ASK));
    expect(
      (await screen.findByRole('button', { name: 'Gmail' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('AgentPanel busy', () => {
  test('disables the input while busy and re-enables it after done settles', async () => {
    renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
    });
    try {
      vi.useFakeTimers();
      act(() => emitAgent('flow-1', { type: 'done' }));
      // Still settling: a mid-turn done must not re-enable the input.
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS - 1);
      });
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(false);
    });
  });

  test('a mid-turn done followed by more events keeps the input disabled through both dones', async () => {
    const { posts } = renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    fireEvent.change(textarea(), { target: { value: 'turn it on' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    try {
      vi.useFakeTimers();
      // activate's mid-turn done, then the turn continues (more events)…
      act(() => emitAgent('flow-1', { type: 'done' }));
      act(() => emitAgent('flow-1', { type: 'say', text: 'Almost done.' }));
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS * 2);
      });
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
      // …then the loop's final done settles to idle.
      act(() => emitAgent('flow-1', { type: 'done' }));
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(false);
    });
  });
});

describe('AgentPanel send errors', () => {
  test('a 409 shows the server message inline and stays busy', async () => {
    const { posts } = renderPanel({
      transcript: [],
      agentPost: () => ({ status: 409, body: { error: 'Still thinking about your last message.' } }),
    });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    // The server message surfaces inline (not a crash)…
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('Still thinking about your last message.')).toBeDefined();
    // …the rejected message is not kept as Dad's…
    expect(screen.queryByText('hello')).toBeNull();
    // …and the running turn keeps the input disabled.
    expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
  });

  test('a network failure shows a fallback and re-enables the input', async () => {
    renderPanel({ transcript: [], failPost: true });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText("Couldn't reach the server. Try again.")).toBeDefined();
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(false);
    });
  });
});

describe('AgentPanel input', () => {
  test('Enter sends, Shift+Enter does not', async () => {
    const { posts } = renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(posts).toHaveLength(0);
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'hello' }]);
    });
  });

  test('empty messages are not sent', async () => {
    const { posts } = renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    fireEvent.change(textarea(), { target: { value: '   ' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts).toHaveLength(0);
  });

  test('the Send button sends the typed text', async () => {
    const { posts } = renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'hello' }]);
    });
  });
});

describe('AgentPanel activity', () => {
  test('activity events render as small lines with a spinner while busy', async () => {
    const { container } = renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(true);
    });
    act(() => emitAgent('flow-1', { type: 'activity', text: 'Reading your inbox' }));
    const line = await screen.findByText('Reading your inbox');
    expect(line.closest('p')?.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    try {
      vi.useFakeTimers();
      act(() => emitAgent('flow-1', { type: 'done' }));
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(false);
    });
    // The line stays; the spinner stops with the turn.
    expect(screen.getByText('Reading your inbox')).toBeDefined();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});

describe('AgentPanel prefill', () => {
  test('prefill fills the input and clears the seam on consume and on send', async () => {
    const onPrefillConsumed = vi.fn();
    const { posts } = renderPanel({ transcript: [], prefill: 'Fix it please', onPrefillConsumed });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    expect((textarea() as HTMLTextAreaElement).value).toBe('Fix it please');
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'Fix it please' }]);
    });
    expect(onPrefillConsumed).toHaveBeenCalledTimes(2);
  });
});

describe('AgentPanel chrome', () => {
  test('the mic button offers push-to-talk', async () => {
    renderPanel({ transcript: [] });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    const mic = screen.getByRole('button', { name: 'Hold to talk' }) as HTMLButtonElement;
    expect(mic.disabled).toBe(false);
  });

  test('the collapse button reports back to the page', async () => {
    const onCollapse = vi.fn();
    renderPanel({ transcript: [], onCollapse });
    await screen.findByText('Tell me what you want this chore reducer to do.');
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  test('initialPrompt sends once on mount', async () => {
    const { posts } = renderPanel({ transcript: [], initialPrompt: 'Build me a saver' });
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'Build me a saver' }]);
    });
    expect(await screen.findByText('Build me a saver')).toBeDefined();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts).toHaveLength(1);
  });

  test('initialPrompt reports the opening send once so the page can consume it', async () => {
    const onInitialSent = vi.fn();
    renderPanel({ transcript: [], initialPrompt: 'Build me a saver', onInitialSent });
    await screen.findByText('Build me a saver');
    expect(onInitialSent).toHaveBeenCalledTimes(1);
  });
});

describe('workflowNameFromSentence', () => {
  test('takes the first 6 words', () => {
    expect(
      workflowNameFromSentence('When a customer emails me, save them and draft a reply for me to check'),
    ).toBe('When a customer emails me, save');
  });

  test('short sentences keep the whole sentence', () => {
    expect(workflowNameFromSentence('Save my customers')).toBe('Save my customers');
    expect(workflowNameFromSentence('  Save   my   customers  ')).toBe('Save my customers');
  });

  test('empty input names nothing (callers guard before POSTing)', () => {
    expect(workflowNameFromSentence('')).toBe('');
    expect(workflowNameFromSentence('   ')).toBe('');
  });
});

describe('AgentPanel history loading states', () => {
  test('a failed transcript GET shows a plain-words error, not the empty hint', async () => {
    renderPanel({ failGet: true });
    expect(await screen.findByText("Couldn't load earlier messages.")).toBeDefined();
    expect(screen.queryByText('Tell me what you want this chore reducer to do.')).toBeNull();
  });

  test('a slow transcript GET shows Loading… until rows arrive (never the empty hint)', async () => {
    let release!: () => void;
    const getGate = new Promise<void>((r) => {
      release = r;
    });
    renderPanel({ transcript: PERSISTED, getGate });
    expect(await screen.findByText('Loading…')).toBeDefined();
    expect(screen.queryByText('Tell me what you want this chore reducer to do.')).toBeNull();
    await act(async () => {
      release();
    });
    expect(await screen.findByText('On it.')).toBeDefined();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  test('live events still render while the transcript GET is failing', async () => {
    renderPanel({ failGet: true });
    await screen.findByText("Couldn't load earlier messages.");
    act(() => emitAgent('flow-1', { type: 'say', text: 'I am still here.' }));
    expect(await screen.findByText('I am still here.')).toBeDefined();
    // The history error stays: earlier messages are still missing.
    expect(screen.getByText("Couldn't load earlier messages.")).toBeDefined();
  });
});

describe('AgentPanel scroll-follow', () => {
  // jsdom never lays out, so scrollHeight is stubbed and the scrollTop setter
  // is spied: the effect under test assigns scrollTop = scrollHeight.
  function watchScroll(): { scrolledTo: () => number } {
    const conv = screen.getByLabelText('Conversation');
    Object.defineProperty(conv, 'scrollHeight', { value: 1000, configurable: true });
    let lastTop = -1;
    Object.defineProperty(conv, 'scrollTop', {
      get: () => lastTop,
      set: (v: number) => {
        lastTop = v;
      },
      configurable: true,
    });
    return { scrolledTo: () => lastTop };
  }

  test('a new row scrolls the conversation to the bottom', async () => {
    renderPanel({ transcript: PERSISTED });
    await screen.findByText('On it.');
    const scroll = watchScroll();
    act(() => emitAgent('flow-1', { type: 'say', text: 'Fresh news.' }));
    await screen.findByText('Fresh news.');
    expect(scroll.scrolledTo()).toBe(1000);
  });

  test('a send error scrolls the alert into view', async () => {
    renderPanel({ transcript: PERSISTED, failPost: true });
    await screen.findByText('On it.');
    const scroll = watchScroll();
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await screen.findByText("Couldn't reach the server. Try again.");
    expect(scroll.scrolledTo()).toBe(1000);
  });
});

describe('AgentPanel remount', () => {
  test('remounting refetches the transcript so a completed turn stays visible', async () => {
    // One client across both mounts, like the app's singleton: without a
    // remount refetch, the second mount would serve the cached pre-turn [].
    let current: AgentTranscriptEntry[] = [];
    const posts: { text: string }[] = [];
    let getCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/workflows/flow-1/agent' && init?.method !== 'POST') {
          getCount += 1;
          const body = current;
          return { ok: true, status: 200, json: async () => body } as Response;
        }
        if (url === '/api/workflows/flow-1/agent' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { text: string };
          posts.push(body);
          return { ok: true, status: 202, text: async () => '{}', json: async () => ({}) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = (
      <QueryClientProvider client={client}>
        <PanelWithAgent />
      </QueryClientProvider>
    );
    const first = render(panel);
    await screen.findByText('Tell me what you want this chore reducer to do.');
    expect(getCount).toBe(1);

    // Complete a turn (mocked): Dad sends, the agent answers, done settles.
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(posts).toEqual([{ text: 'hello' }]);
    });
    act(() => emitAgent('flow-1', { type: 'say', text: 'Done deal.' }));
    await screen.findByText('Done deal.');
    try {
      vi.useFakeTimers();
      act(() => emitAgent('flow-1', { type: 'done' }));
      await act(async () => {
        vi.advanceTimersByTime(AGENT_SETTLING_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      expect((textarea() as HTMLTextAreaElement).disabled).toBe(false);
    });

    // The server persisted the turn; collapse/reopen remounts the panel.
    current = [
      { role: 'dad', text: 'hello', at: 10 },
      { role: 'agent', text: 'Done deal.', at: 11 },
    ];
    first.unmount();
    render(panel);
    // The remount refetches instead of serving the stale pre-turn cache…
    await waitFor(() => {
      expect(getCount).toBe(2);
    });
    // …so the completed answer is visible without a reload.
    expect(await screen.findByText('Done deal.')).toBeDefined();
    expect(screen.getByText('hello')).toBeDefined();
  });
});
