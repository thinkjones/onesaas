import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MOOD_DRAW_TIMEOUT_MS, type Settings } from '../api.ts';
import AppRoutes from '../routes.tsx';
import Onboarding from './Onboarding.tsx';
import type { UseVoiceResult, VoiceState } from '../voice/useVoice.ts';

// M5 Task 5: four-screen onboarding. The sound engine is stubbed: these tests
// assert the onboarding *calls* unlock/ambient, not that audio plays.
vi.mock('../sound/sound.ts', () => ({
  sound: { unlock: vi.fn(), ambient: vi.fn(), chime: vi.fn(), setVolume: vi.fn(), setEnabled: vi.fn() },
}));
import { sound } from '../sound/sound.ts';

const SCREEN1_COPY = "Technology has made running a business harder, not easier. That's not your fault.";
const SCREEN3_COPY = "You've kept a business running through all of it. That's the hard part.";

function settingsDoc(overrides?: Partial<Settings>): Settings {
  return {
    businessName: '',
    businessWhat: '',
    timezone: 'America/Los_Angeles',
    theme: 'morning',
    textSize: 'normal',
    sound: { on: true, volume: 0.25 },
    onboarded: false,
    moodFileIds: [],
    ...overrides,
  };
}

interface FetchLog {
  puts: unknown[];
  moodPosts: number;
}

function stubFetch(
  doc: Settings,
  log: FetchLog,
  pairing = { paired: false, connected: false },
  moodOk = true,
  putOk = true,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings' && (init?.method === undefined || init?.method === 'GET')) {
        return { ok: true, json: async () => doc } as Response;
      }
      if (url === '/api/settings' && init?.method === 'PUT') {
        log.puts.push(JSON.parse(String(init.body)));
        if (!putOk) {
          return { ok: false, status: 500, text: async () => '{"error":"boom"}' } as Response;
        }
        return { ok: true, json: async () => ({ ...doc, ...JSON.parse(String(init.body)) }) } as Response;
      }
      if (url === '/api/mood/generate' && init?.method === 'POST') {
        log.moodPosts += 1;
        if (!moodOk) {
          return { ok: false, status: 500, text: async () => '{"error":"boom"}' } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === '/api/pairing/status') {
        return { ok: true, json: async () => pairing } as Response;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }),
  );
}

function renderOnboarding(
  doc: Settings,
  log: FetchLog,
  path = '/welcome',
  pairing = { paired: false, connected: false },
  moodOk = true,
  putOk = true,
) {
  stubFetch(doc, log, pairing, moodOk, putOk);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fakeVoice(): UseVoiceResult {
  return {
    state: 'idle' as VoiceState,
    partial: '',
    error: undefined,
    start: vi.fn(async () => {}),
    stop: vi.fn(() => {}),
    onFinal: vi.fn(() => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('first render with onboarded:false shows the screen 1 copy exactly', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  expect(await screen.findByText(SCREEN1_COPY)).not.toBeNull();
  expect(screen.getByRole('button', { name: "Let's fix that." })).not.toBeNull();
  expect(screen.getByRole('progressbar', { name: 'Onboarding progress' })).toHaveProperty(
    'ariaValueNow',
    '1',
  );
  unmount();
});

test('welcome continues to the business screen and unlocks sound', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  expect(sound.unlock).toHaveBeenCalledTimes(1);
  expect(sound.ambient).toHaveBeenCalledWith(true);
  expect(await screen.findByText("What's your business called?")).not.toBeNull();
  unmount();
});

test('filling screen 2 and pressing Next saves settings and calls the mood endpoint', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));

  fireEvent.change(await screen.findByLabelText("What's your business called?"), {
    target: { value: 'Corner Hardware' },
  });
  fireEvent.change(screen.getByLabelText('What do you do?'), {
    target: { value: 'We run a family hardware store' },
  });
  // Timezone comes pre-filled from settings.
  expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('America/Los_Angeles');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  expect(log.puts).toContainEqual({
    businessName: 'Corner Hardware',
    businessWhat: 'We run a family hardware store',
    timezone: 'America/Los_Angeles',
  });
  expect(log.moodPosts).toBe(1);
  unmount();
});

test('screen 2 awaits the settings save before firing the mood POST', async () => {
  const order: string[] = [];
  const doc = settingsDoc();
  // The PUT response stays pending until the test releases it, so any
  // fire-and-forget POST would land in `order` before 'put-resolved'.
  let resolvePut!: (res: Response) => void;
  const putGate = new Promise<Response>((resolve) => {
    resolvePut = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings' && (init?.method === undefined || init?.method === 'GET')) {
        return { ok: true, json: async () => doc } as Response;
      }
      if (url === '/api/settings' && init?.method === 'PUT') {
        order.push('put-request');
        const res = await putGate;
        order.push('put-resolved');
        return res;
      }
      if (url === '/api/mood/generate' && init?.method === 'POST') {
        order.push('mood-post');
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === '/api/pairing/status') {
        return { ok: true, json: async () => ({ paired: false, connected: false }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  // The save is still in flight: the mood POST must not have fired yet.
  await act(async () => {
    await Promise.resolve();
  });
  expect(order).not.toContain('mood-post');
  await act(async () => {
    resolvePut({ ok: true, json: async () => doc } as Response);
    await putGate;
  });
  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  expect(order).toEqual(['put-request', 'put-resolved', 'mood-post']);
  unmount();
});

test('an invalid timezone shows an inline error and does not advance', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  fireEvent.change(await screen.findByLabelText('Timezone'), {
    target: { value: 'Not/AZone' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByRole('alert')).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/valid timezone/);
  // Still on screen 2: nothing saved, no mood POST, no advance.
  expect(screen.getByLabelText("What's your business called?")).not.toBeNull();
  expect(screen.queryByText(SCREEN3_COPY)).toBeNull();
  expect(log.puts).toEqual([]);
  expect(log.moodPosts).toBe(0);

  // Fixing the zone clears the error and the same click advances.
  fireEvent.change(screen.getByLabelText('Timezone'), {
    target: { value: 'America/New_York' },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  unmount();
});

test('a voice final fills the "What do you do?" field', async () => {
  const doc = settingsDoc();
  const log: FetchLog = { puts: [], moodPosts: 0 };
  stubFetch(doc, log);
  let finalCb: ((text: string) => void) | null = null;
  const voice = fakeVoice();
  voice.onFinal = vi.fn((cb: (text: string) => void) => {
    finalCb = cb;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/welcome']}>
        <Onboarding useVoiceFn={() => voice} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText('What do you do?');
  expect(finalCb).not.toBeNull();
  act(() => {
    finalCb!('We run a family hardware store');
  });
  expect((screen.getByLabelText('What do you do?') as HTMLInputElement).value).toBe(
    'We run a family hardware store',
  );
  unmount();
});

test('screen 3 shows the reframe copy and three example cards', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  expect(screen.getByText(/Think about the chores that eat your evenings/)).not.toBeNull();
  expect(screen.getByText('Answer customer emails faster')).not.toBeNull();
  expect(screen.getByText('Keep track of bookings')).not.toBeNull();
  expect(screen.getByText('Turn a photo into a post')).not.toBeNull();
  unmount();
});

test('screen 3 after a fake 20s timer still shows the cards (defaults fallback)', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");

  try {
    // Fake timers from here: the Next click below schedules the fallback
    // on the fake clock. The save it awaits is pure microtasks (no timers
    // in the stub), so drain them until screen 3 lands — findBy's waitFor
    // cannot poll under fake timers.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await act(async () => {
      for (let i = 0; i < 100 && screen.queryByText(SCREEN3_COPY) === null; i++) {
        await Promise.resolve();
      }
    });
    expect(screen.getByText(SCREEN3_COPY)).not.toBeNull();
    expect(screen.getByText('Drawing your business…')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(MOOD_DRAW_TIMEOUT_MS);
    });
    // The 20s fallback fired: the shimmer is gone but nothing blocks.
    expect(screen.queryByText('Drawing your business…')).toBeNull();
    expect(screen.getByText('Answer customer emails faster')).not.toBeNull();
    expect(screen.getByText('Keep track of bookings')).not.toBeNull();
    expect(screen.getByText('Turn a photo into a post')).not.toBeNull();
    // And the backdrop still shows the bundled defaults.
    const srcs = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).toContain('/mood/default-1.jpg');
  } finally {
    vi.useRealTimers();
  }
  unmount();
});

test('a mood event swaps the backdrop to the generated set', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  // A scripted EventSource double: the test drives events through emit().
  let onmessage: ((msg: MessageEvent) => void) | null = null;
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage: ((msg: MessageEvent) => void) | null = null;
      constructor() {
        onmessage = (msg) => this.onmessage?.(msg);
      }
      close(): void {}
    },
  );
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);

  expect(onmessage).not.toBeNull();
  act(() => {
    onmessage!({ data: JSON.stringify({ type: 'mood', fileIds: ['aaa', 'bbb'] }) } as MessageEvent);
  });
  const srcs = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
  expect(srcs).toContain('/api/files/aaa');
  expect(srcs).toContain('/api/files/bbb');
  unmount();
});

test('Back is available on screens 2-4', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  await screen.findByText(SCREEN1_COPY);
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(SCREEN1_COPY)).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByLabelText("What's your business called?")).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Skip for now' });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  unmount();
});

test('"Skip for now" on screen 4 sets onboarded:true and navigates to /', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
  expect(await screen.findByText('Home')).not.toBeNull();
  expect(log.puts).toContainEqual({ onboarded: true });
  unmount();
});

test('"Finish" on screen 4 sets onboarded:true and navigates to /', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
  expect(await screen.findByText('Home')).not.toBeNull();
  expect(log.puts).toContainEqual({ onboarded: true });
  unmount();
});

test('a failing mood POST still advances to screen 3', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(
    settingsDoc(),
    log,
    '/welcome',
    { paired: false, connected: false },
    false,
  );
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  // The 500 is swallowed (best-effort): onboarding still advances.
  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  expect(log.moodPosts).toBe(1);
  unmount();
});

test('screen 4 shows a big checkmark once the extension is paired', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log, '/welcome', {
    paired: true,
    connected: true,
  });
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByRole('img', { name: 'Chrome extension paired' })).not.toBeNull();
  unmount();
});

test('screen 4 links to the unpacked-extension install instructions', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc(), log);
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText(SCREEN3_COPY);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  const link = await screen.findByRole('link', { name: 'Install the extension' });
  expect(link.getAttribute('href')).toBe(
    'https://github.com/thinkjones/meta-ai-hackathon-my-dads-ai-agent#loading-the-extension-unpacked',
  );
  // Unpaired: the big checkmark stays hidden.
  expect(screen.queryByRole('img', { name: 'Chrome extension paired' })).toBeNull();
  unmount();
});

test('an already-onboarded visit to /welcome goes to /', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(settingsDoc({ onboarded: true }), log);
  expect(await screen.findByText('Home')).not.toBeNull();
  unmount();
});

test('any route redirects to /welcome when onboarded is false', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  stubFetch(settingsDoc(), log);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(SCREEN1_COPY)).not.toBeNull();
  unmount();
});

test('no redirect when onboarded is true', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  stubFetch(settingsDoc({ onboarded: true }), log);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Settings' })).not.toBeNull();
  expect(screen.queryByText(SCREEN1_COPY)).toBeNull();
  unmount();
});

test('the gate renders Loading… while settings load (no content, no redirect)', async () => {
  const doc = settingsDoc();
  const log: FetchLog = { puts: [], moodPosts: 0 };
  // The settings GET stays pending until the test releases it.
  let resolveGet!: (res: Response) => void;
  const getGate = new Promise<Response>((resolve) => {
    resolveGet = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings' && (init?.method === undefined || init?.method === 'GET')) {
        return getGate;
      }
      if (url === '/api/settings' && init?.method === 'PUT') {
        log.puts.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => doc } as Response;
      }
      if (url === '/api/mood/generate' && init?.method === 'POST') {
        log.moodPosts += 1;
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === '/api/pairing/status') {
        return { ok: true, json: async () => ({ paired: false, connected: false }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  // While settings are in flight: the placeholder, and nothing else.
  expect(await screen.findByText('Loading…')).not.toBeNull();
  expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  expect(screen.queryByText(SCREEN1_COPY)).toBeNull();

  // Once settings land, the normal gate behavior resumes (redirect to /welcome).
  await act(async () => {
    resolveGet({ ok: true, json: async () => doc } as Response);
    await getGate;
  });
  expect(await screen.findByText(SCREEN1_COPY)).not.toBeNull();
  unmount();
});

test('a failing settings PUT still advances to screen 3 and fires the mood POST', async () => {
  const log: FetchLog = { puts: [], moodPosts: 0 };
  const { unmount } = renderOnboarding(
    settingsDoc(),
    log,
    '/welcome',
    { paired: false, connected: false },
    true,
    false,
  );
  fireEvent.click(await screen.findByRole('button', { name: "Let's fix that." }));
  await screen.findByLabelText("What's your business called?");
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  // The 500 is swallowed by the try/catch (never-block): onboarding still
  // advances and the mood POST still fires.
  expect(await screen.findByText(SCREEN3_COPY)).not.toBeNull();
  expect(log.puts).toHaveLength(1);
  expect(log.moodPosts).toBe(1);
  unmount();
});
