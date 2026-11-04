import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { ModelKeyStatus, Settings } from '../api.ts';
import AppRoutes from '../routes.tsx';
import Onboarding from './Onboarding.tsx';
import type { UseVoiceResult, VoiceState } from '../voice/useVoice.ts';

const WELCOME = "Technology has made running a business harder, not easier. That's not your fault.";

function settingsDoc(overrides?: Partial<Settings>): Settings {
  return {
    businessName: '',
    businessWhat: '',
    timezone: 'America/Los_Angeles',
    textSize: 'normal',
    onboarded: false,
    moodFileIds: [],
    vertical: null,
    interests: [],
    interestsNote: '',
    ...overrides,
  };
}

interface Log {
  puts: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  workflowCreates: number;
  moodPosts: number;
}

interface Stub {
  doc?: Settings;
  pairing?: { paired: boolean; connected: boolean };
  check?: ModelKeyStatus | (() => ModelKeyStatus);
  connection?: Record<string, unknown>;
  putOk?: boolean;
}

function stubFetch(opts: Stub = {}): Log {
  const log: Log = { puts: [], connections: [], workflowCreates: 0, moodPosts: 0 };
  let doc = opts.doc ?? settingsDoc();
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings' && method === 'GET') return ok(doc);
      if (url === '/api/settings' && method === 'PUT') {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        log.puts.push(patch);
        if (opts.putOk === false) {
          return { ok: false, status: 500, text: async () => '{"error":"boom"}' } as Response;
        }
        doc = { ...doc, ...patch };
        return ok(doc);
      }
      if (url === '/api/mood/generate') {
        log.moodPosts += 1;
        return ok({});
      }
      if (url === '/api/models/connection' && method === 'GET') {
        return ok(opts.connection ?? { baseUrl: '', model: '', hasApiKey: false, hasEnvKey: false });
      }
      if (url === '/api/models/connection' && method === 'PUT') {
        log.connections.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return ok({ baseUrl: '', model: '', hasApiKey: true });
      }
      if (url === '/api/models/check') {
        const status = typeof opts.check === 'function' ? opts.check() : (opts.check ?? 'ok');
        return ok({ status });
      }
      if (url === '/api/pairing/status') {
        return ok({ generation: 1, lastPingAt: null, peer: null, ...(opts.pairing ?? { paired: false, connected: false }) });
      }
      if (url === '/api/pairing/start') return ok({ code: '482913' });
      if (url === '/api/extension/install') return ok({ path: '/Users/me/OneSaaS Extension' });
      if (url === '/api/workflows' && method === 'POST') {
        log.workflowCreates += 1;
        return ok({ id: 'wf-new' });
      }
      if (url === '/api/runs' || url === '/api/models/status' || url === '/api/workflows') return ok([]);
      throw new Error(`unexpected fetch: ${url} ${method}`);
    }),
  );
  return log;
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

function renderSetup(opts: Stub = {}, useVoiceFn: () => UseVoiceResult = fakeVoice) {
  const log = stubFetch(opts);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<Onboarding useVoiceFn={useVoiceFn} />} />
          <Route path="/" element={<div>Home</div>} />
          <Route path="/automate" element={<div>Automate page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { log, ...view };
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const open = () => document.querySelector('[aria-current="step"]') as HTMLElement;
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

async function toBusiness() {
  await heading(WELCOME);
  press("Let's fix that");
  await heading("What's your business, and what do you do?");
}

async function toInterests(what = 'Taxi and airport transfers') {
  await toBusiness();
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Prestige Transfers' } });
  fireEvent.change(screen.getByLabelText('What you do'), { target: { value: what } });
  press('Looks good');
  await heading("Highlight anything you'd like help with");
}

async function toModel() {
  await toInterests();
  press('Next');
  await heading('Can I reach your AI model?');
}

async function toConnect() {
  await toModel();
  fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await heading('Install the Chrome extension');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('all six nodes show, with only the current one open', async () => {
  const { unmount } = renderSetup();
  await heading(WELCOME);
  expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(document.querySelectorAll('.onb-node-todo')).toHaveLength(5);
  expect(screen.getByText('Your Automate page, set up for you')).toBeDefined();
  const progress = screen.getByRole('progressbar', { name: 'Setup progress' });
  expect(progress.getAttribute('aria-valuenow')).toBe('1');
  expect(progress.getAttribute('aria-valuemax')).toBe('5');
  expect(progress.textContent).toBe('Step 1 of 5');
  unmount();
});

test('every open step has a ? button that answers in the chat', async () => {
  const { unmount } = renderSetup();
  await heading(WELCOME);
  press('What is this step?');
  expect(within(screen.getByRole('complementary', { name: 'Chat' })).getByText(/This is where we start/)).toBeDefined();
  unmount();
});

test('chips and typed messages get an answer in the chat', async () => {
  const { unmount } = renderSetup();
  await heading(WELCOME);
  press('How long will this take?');
  expect(screen.getByText(/A few minutes/)).toBeDefined();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Can you do my taxes?' } });
  press('Send');
  expect(screen.getByText('Can you do my taxes?')).toBeDefined();
  expect(screen.getByText(/can't look into that during setup/)).toBeDefined();
  unmount();
});

test('the business step saves its fields, with the time zone by its real name', async () => {
  const { log, unmount } = renderSetup();
  await toInterests();
  expect(log.puts[0]).toEqual({
    businessName: 'Prestige Transfers',
    businessWhat: 'Taxi and airport transfers',
    timezone: 'America/Los_Angeles',
    vertical: 'taxi',
  });
  expect(screen.getByText('Prestige Transfers runs taxi and airport transfers on Pacific time.')).toBeDefined();
  unmount();
});

test('the time zone shows a friendly label and accepts a city', async () => {
  const { log, unmount } = renderSetup();
  await toBusiness();
  const zone = screen.getByLabelText('Your time zone') as HTMLInputElement;
  expect(zone.value).toBe('Los Angeles (Pacific time)');
  fireEvent.change(zone, { target: { value: 'Chicago' } });
  press('Looks good');
  await heading("Highlight anything you'd like help with");
  expect(log.puts[0]?.['timezone']).toBe('America/Chicago');
  unmount();
});

test('an unknown time zone shows an inline message and stays put', async () => {
  const { log, unmount } = renderSetup();
  await toBusiness();
  fireEvent.change(screen.getByLabelText('Your time zone'), { target: { value: 'Mars/Olympus' } });
  press('Looks good');
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(log.puts).toEqual([]);
  expect(open().getAttribute('aria-label')).toBe('Your business');
  unmount();
});

test('a voice final fills "What you do"', async () => {
  // The field's mic and the chat's mic share the seam, so deliver to both.
  const listeners = new Set<(text: string) => void>();
  const voice = fakeVoice();
  const useVoiceFn = () => ({
    ...voice,
    onFinal: (cb: (text: string) => void) => {
      listeners.add(cb);
    },
  });
  const { unmount } = renderSetup({}, useVoiceFn);
  await toBusiness();
  act(() => listeners.forEach((listen) => listen('We run a bakery')));
  await waitFor(() => {
    expect((screen.getByLabelText('What you do') as HTMLInputElement).value).toBe('We run a bakery');
  });
  unmount();
});

test('"Sounds like" guesses from the words, and can be changed', async () => {
  const { log, unmount } = renderSetup();
  await toBusiness();
  const what = screen.getByLabelText('What you do');
  fireEvent.change(what, { target: { value: 'We fix blocked drains' } });
  const group = screen.getByRole('group', { name: 'Sounds like' });
  expect(within(group).getByRole('button', { name: 'Plumber' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(group).getByRole('button', { name: 'Something else' }));
  press('Looks good');
  await heading("Highlight anything you'd like help with");
  expect(log.puts[0]?.['vertical']).toBeNull();
  unmount();
});

test('interests start with three from the pack, save, and build nothing', async () => {
  const { log, unmount } = renderSetup();
  await toInterests();
  const pressed = () =>
    [...open().querySelectorAll('.onb-tag[aria-pressed="true"]')].map((el) => el.textContent);
  expect(screen.getByRole('group', { name: 'Popular with taxi owners' })).toBeDefined();
  expect(pressed()).toEqual(['Missed calls', 'Taking bookings', 'Licences and insurance']);
  expect(screen.getByText('3 highlighted')).toBeDefined();
  press('Missed calls');
  press('A morning summary');
  fireEvent.change(screen.getByLabelText(/Anything else/), { target: { value: 'Airport pickups' } });
  press('Next');
  await heading('Can I reach your AI model?');
  expect(log.puts[1]).toEqual({ interests: [3, 19, 20], interestsNote: 'Airport pickups' });
  expect(log.workflowCreates).toBe(0);
  expect(screen.getByText("You'd like help with taking bookings, licences and insurance and a morning summary.")).toBeDefined();
  unmount();
});

test('Back and a done step both reopen with the saved values', async () => {
  const { unmount } = renderSetup();
  await toInterests();
  press('Back');
  await heading("What's your business, and what do you do?");
  expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('Prestige Transfers');
  press('Looks good');
  await heading("Highlight anything you'd like help with");
  fireEvent.click(screen.getByRole('button', { name: /Prestige Transfers runs/ }));
  await heading("What's your business, and what do you do?");
  expect((screen.getByLabelText('What you do') as HTMLInputElement).value).toBe('Taxi and airport transfers');
  unmount();
});

test('focus moves into each step that opens', async () => {
  const { unmount } = renderSetup();
  await heading(WELCOME);
  press("Let's fix that");
  const next = await heading("What's your business, and what do you do?");
  expect(document.activeElement).toBe(next);
  unmount();
});

test('with no key, the model step asks for one before going on', async () => {
  const { unmount } = renderSetup();
  await toModel();
  const primary = screen.getByRole('button', { name: 'Looks good' }) as HTMLButtonElement;
  expect(primary.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } });
  expect(primary.disabled).toBe(false);
  unmount();
});

test('finishing lands on the Automate page, not Activity, even once the flag is saved', async () => {
  const { unmount } = renderSetup();
  await heading(WELCOME);
  press('Skip setup');
  expect(await screen.findByText('Automate page')).toBeDefined();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(screen.queryByText('Home')).toBeNull();
  unmount();
});

test('a working key saves, checks and moves on', async () => {
  const { log, unmount } = renderSetup({ check: 'ok' });
  await toModel();
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'good-key' } });
  press('Looks good');
  await heading('Install the Chrome extension');
  expect(log.connections[0]).toMatchObject({ apiKey: 'good-key' });
  expect(screen.getByText("Your AI model answered. I'm ready to think.")).toBeDefined();
  unmount();
});

test('a rejected key shows what to fix and keeps the primary shut until edited', async () => {
  const { unmount } = renderSetup({ check: 'rejected' });
  await toModel();
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad-key' } });
  press('Looks good');
  expect(await screen.findByText('Needs a look')).toBeDefined();
  expect(screen.getByText(/turned down your API key/)).toBeDefined();
  expect(open().getAttribute('data-failed')).toBe('true');
  expect((screen.getByRole('button', { name: 'Looks good' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'another' } });
  expect((screen.getByRole('button', { name: 'Looks good' }) as HTMLButtonElement).disabled).toBe(false);
  expect(open().getAttribute('data-failed')).toBe('false');
  unmount();
});

test('when the check can\'t tell, it warns and lets you carry on', async () => {
  const { unmount } = renderSetup({ check: 'unknown' });
  await toModel();
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } });
  press('Looks good');
  expect(await screen.findByText(/couldn't check this from here/)).toBeDefined();
  press('Looks good');
  await heading('Install the Chrome extension');
  unmount();
});

test('a key already set is checked straight away, with nothing to paste', async () => {
  const { unmount } = renderSetup({ connection: { baseUrl: '', model: '', hasApiKey: false, hasEnvKey: true }, check: 'ok' });
  await toModel();
  expect(await screen.findByText(/found a key already set/)).toBeDefined();
  expect(await screen.findByText("Your model answered. I'm ready to think.")).toBeDefined();
  press('Looks good');
  await heading('Install the Chrome extension');
  unmount();
});

test('skipping the model marks it Skipped', async () => {
  const { unmount } = renderSetup();
  await toConnect();
  expect(screen.getByText('Skipped for now.')).toBeDefined();
  expect(screen.getByText('Skipped')).toBeDefined();
  unmount();
});

test('the extension step shows its code; Finish waits for pairing and Skip finishes', async () => {
  const { log, unmount } = renderSetup();
  await toConnect();
  expect(await screen.findByText('482 913')).toBeDefined();
  expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(true);
  press('Skip for now');
  expect(await screen.findByText('Automate page')).toBeDefined();
  expect(log.puts.at(-1)).toEqual({ onboarded: true });
  unmount();
});

test('the extension comes with the app: Get it says where it is and how to load it', async () => {
  const { unmount } = renderSetup();
  await toConnect();
  press('Get the extension');
  expect(await screen.findByText('/Users/me/OneSaaS Extension')).toBeDefined();
  expect(screen.getByText('chrome://extensions')).toBeDefined();
  expect(screen.getByText(/Click Load unpacked/)).toBeDefined();
  expect(document.querySelector('a[href*="github.com"]')).toBeNull();
  unmount();
});

test('once paired, Finish setup finishes', async () => {
  const { log, unmount } = renderSetup({ pairing: { paired: true, connected: true } });
  await toConnect();
  await waitFor(() => {
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(false);
  });
  press('Finish setup');
  expect(await screen.findByText('Automate page')).toBeDefined();
  expect(log.puts.at(-1)).toEqual({ onboarded: true });
  unmount();
});

test('Skip setup finishes from any step', async () => {
  const { log, unmount } = renderSetup();
  await heading(WELCOME);
  press('Skip setup');
  expect(await screen.findByText('Automate page')).toBeDefined();
  expect(log.puts.at(-1)).toEqual({ onboarded: true });
  unmount();
});

test('a failed save never blocks setup', async () => {
  const { unmount } = renderSetup({ putOk: false });
  await toBusiness();
  press('Looks good');
  await heading("Highlight anything you'd like help with");
  unmount();
});

test('no step ever mentions Gmail, and no drawing is requested', async () => {
  const { log, container, unmount } = renderSetup();
  await heading(WELCOME);
  expect(container.textContent).not.toMatch(/gmail/i);
  await toInterestsFromWelcome();
  expect(container.textContent).not.toMatch(/gmail/i);
  press('Next');
  await heading('Can I reach your AI model?');
  expect(container.textContent).not.toMatch(/gmail/i);
  fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await heading('Install the Chrome extension');
  expect(await screen.findByText('482 913')).toBeDefined();
  expect(container.textContent).not.toMatch(/gmail/i);
  expect(log.moodPosts).toBe(0);
  unmount();
});

async function toInterestsFromWelcome() {
  press("Let's fix that");
  await heading("What's your business, and what do you do?");
  press('Looks good');
  await heading("Highlight anything you'd like help with");
}

test('an already-onboarded visit to /welcome goes to /', async () => {
  const { unmount } = renderSetup({ doc: settingsDoc({ onboarded: true }) });
  expect(await screen.findByText('Home')).toBeDefined();
  unmount();
});

test('any route redirects to /welcome when onboarded is false', async () => {
  stubFetch();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(WELCOME)).not.toBeNull();
  unmount();
});

test('no redirect when onboarded is true', async () => {
  stubFetch({ doc: settingsDoc({ onboarded: true }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Settings' })).not.toBeNull();
  expect(screen.queryByText(WELCOME)).toBeNull();
  unmount();
});

test('the gate renders Loading… while settings load (no content, no redirect)', async () => {
  const doc = settingsDoc();
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
  expect(screen.queryByText(WELCOME)).toBeNull();

  // Once settings land, the normal gate behavior resumes (redirect to /welcome).
  await act(async () => {
    resolveGet({ ok: true, json: async () => doc } as Response);
    await getGate;
  });
  expect(await screen.findByText(WELCOME)).not.toBeNull();
  unmount();
});

