import { ServerToExtension } from '@dad/shared';
import {
  SITE_START_URL,
  SITE_TAB_QUERY,
  createTabManager,
  type TabsLike,
  type WorkerSite,
} from './tabs.js';

/**
 * Injectable seams so background.test.ts drives this module with hand mocks
 * instead of WXT/Chrome. The entrypoint (entrypoints/background.ts) adapts
 * the real WXT `browser` + DOM WebSocket to these narrow interfaces; the
 * core below never touches a global except via the optional timers (which
 * default to call-throughs on globalThis so vitest fake timers just work).
 */

export interface SocketLike {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  // `any` event params are deliberate: they make the real DOM WebSocket
  // structurally assignable (MessageEvent vs { data } would otherwise fail
  // contravariance). Handlers only read ev.data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onopen: ((ev?: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessage: ((ev: any) => void) | null;
  onclose: (() => void) | null;
}

export interface WebSocketCtor {
  new (url: string): SocketLike;
  readonly OPEN: number;
  readonly CLOSED: number;
}

/** Promise-style browser surface (WXT `browser`, NOT callback-style chrome.*). */
export interface BrowserLike {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  tabs: TabsLike & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendMessage(tabId: number, message: any): Promise<unknown>;
  };
  runtime: {
    onMessage: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addListener(fn: (message: any) => unknown): void;
    };
  };
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Call-throughs resolved at invocation time, so fake timers apply. */
const globalTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

export const WS_URL = 'ws://127.0.0.1:8787/ext';
export const TOKEN_KEY = 'dadExtToken';
export const GMAIL_TAB_QUERY = 'https://mail.google.com/*';

/** SAME string as the server's gmail site message — consistent UX either side. */
export const NO_GMAIL_TAB = 'I need Gmail open in Chrome to do this.';
export const TAB_SILENT = "Gmail tab didn't answer.";
export const NO_ANSWER = 'No answer from the app. Is it running?';

/** Per-site "need it open" messages — SAME strings as the server's. */
export const NO_TAB: Record<WorkerSite, string> = {
  gmail: NO_GMAIL_TAB,
  calendar: 'I need Google Calendar open in Chrome to do this.',
  meta: 'I need Meta Business Suite open in Chrome to do this.',
};

/** Per-site "tab didn't answer" messages. */
export const TAB_SILENT_FOR: Record<WorkerSite, string> = {
  gmail: TAB_SILENT,
  calendar: "Calendar tab didn't answer.",
  meta: "Meta tab didn't answer.",
};

/**
 * Codes the background ever posts. Tab replies carrying anything else are
 * sent WITHOUT a code: the server's protocol parser would reject the whole
 * result and the call would hang to its timeout.
 */
const VALID_CODES: readonly string[] = ['SELECTOR_MISSING', 'NOT_OPEN', 'TIMEOUT', 'HANDOFF'];

function validCode(code: unknown): string | undefined {
  return typeof code === 'string' && VALID_CODES.includes(code) ? code : undefined;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const PING_EVERY_MS = 20000;
const PAIR_TIMEOUT_MS = 5000;
const TRIGGER_TIMEOUT_MS = 5000;

interface PendingPair {
  resolve: (reply: { ok: true } | { ok: false; error: string }) => void;
  timer: unknown;
}

export interface Background {
  boot(): Promise<void>;
  dispose(): void;
}

export function createBackground(deps: {
  browser: BrowserLike;
  WebSocket: WebSocketCtor;
  timers?: Timers;
}): Background {
  const { browser, WebSocket } = deps;
  const timers = deps.timers ?? globalTimers;

  let token: string | null = null;
  let socket: SocketLike | null = null;
  let failures = 0;
  let reconnectTimer: unknown = null;
  let pingTimer: unknown = null;
  let pendingPair: PendingPair | null = null;
  let openWaiters: Array<() => void> = [];
  let readyWaiters: Array<() => void> = [];
  let helloAcked = false;
  let disposed = false;
  // Last workflow-button list from the server. The server sends `buttons`
  // only on hello, so Gmail tabs that boot later pull this via `getButtons`
  // instead of waiting for a push that already happened. An empty list is a
  // valid state and CLEARS stale buttons (e.g. workflows deleted server-side).
  let lastButtons: Array<{ workflowId: string; label: string }> = [];

  const tabManager = createTabManager({ tabs: browser.tabs });

  const isOpen = () => socket !== null && socket.readyState === WebSocket.OPEN;

  function send(msg: unknown): void {
    if (!isOpen()) return; // Triggers/pings while disconnected drop silently.
    try {
      socket!.send(JSON.stringify(msg));
    } catch {
      // A send that throws means a dead socket; onclose will reconnect.
    }
  }

  function clearPing(): void {
    if (pingTimer !== null) {
      timers.clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function connect(): void {
    // A live or still-connecting socket wins: reconnect timers and pair-flow
    // connects racing each other must not open duplicate sockets.
    if (socket !== null && socket.readyState !== WebSocket.CLOSED) return;
    if (disposed) return;
    const ws = new WebSocket(WS_URL);
    socket = ws;
    helloAcked = false;
    ws.onopen = () => {
      failures = 0;
      clearPing();
      pingTimer = timers.setInterval(() => send({ type: 'ping' }), PING_EVERY_MS);
      if (token) send({ type: 'hello', token });
      // Waiters survive closes and resolve on ANY future open within budget,
      // so a pair racing a reconnect still lands.
      const waiters = openWaiters;
      openWaiters = [];
      for (const w of waiters) w();
    };
    ws.onmessage = (ev: { data: string }) => {
      void handleServerMessage(ev.data);
    };
    ws.onclose = () => {
      clearPing();
      helloAcked = false;
      if (disposed) return;
      // Backoff 1, 2, 5, 10s, then stay at 10s.
      const delay = RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)]!;
      failures += 1;
      reconnectTimer = timers.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  }

  function waitForOpen(ms: number): Promise<boolean> {
    if (isOpen()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = timers.setTimeout(() => {
        openWaiters = openWaiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      const done = () => {
        timers.clearTimeout(timer);
        resolve(true);
      };
      openWaiters.push(done);
    });
  }

  /** Same shape as waitForOpen, but for the server's hello-ack (`ready`). */
  function waitForReady(ms: number): Promise<boolean> {
    if (helloAcked) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = timers.setTimeout(() => {
        readyWaiters = readyWaiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      const done = () => {
        timers.clearTimeout(timer);
        resolve(true);
      };
      readyWaiters.push(done);
    });
  }

  async function gmailTabs(): Promise<number[]> {
    try {
      const tabs = await browser.tabs.query({ url: GMAIL_TAB_QUERY });
      return tabs.map((t) => t.id).filter((id): id is number => typeof id === 'number');
    } catch {
      return [];
    }
  }

  /** Best-effort fan-out: one dead tab must not starve the rest. */
  async function fanOut(msg: unknown): Promise<void> {
    const ids = await gmailTabs();
    await Promise.all(
      ids.map(async (id) => {
        try {
          await browser.tabs.sendMessage(id, msg);
        } catch {
          // Tab closed mid-send; ignore.
        }
      }),
    );
  }

  async function handleServerMessage(raw: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return; // Malformed JSON: ignore (symmetric with the server).
    }
    const parsed = ServerToExtension.safeParse(json);
    if (!parsed.success) return; // Unknown/wrong-direction messages: ignore.
    const msg = parsed.data;

    switch (msg.type) {
      case 'paired': {
        token = msg.token;
        try {
          await browser.storage.local.set({ [TOKEN_KEY]: token });
        } catch {
          // Practically unreachable; the in-memory token still lasts the
          // session, and this keeps the event handler from rejecting.
        }
        send({ type: 'hello', token });
        const pending = pendingPair;
        pendingPair = null;
        if (pending) {
          timers.clearTimeout(pending.timer);
          pending.resolve({ ok: true });
        }
        break;
      }
      case 'ready': {
        // Store nothing, forward nothing: buttons always arrive separately
        // (and are [] in M1 anyway). But mark the hello acked so queued
        // triggers may send.
        helloAcked = true;
        const waiters = readyWaiters;
        readyWaiters = [];
        for (const w of waiters) w();
        break;
      }
      case 'buttons': {
        // Clone, never alias: the parsed object is per-message garbage and
        // fan-out/getButtons consumers must not share references with it.
        // Runs on EVERY buttons message, including empty (empty clears).
        lastButtons = msg.items.map((i) => ({ workflowId: i.workflowId, label: i.label }));
        await fanOut({ type: 'buttons', items: msg.items });
        break;
      }
      case 'runStatus': {
        // Content scripts filter by threadId; every Gmail tab gets a copy.
        await fanOut(msg);
        break;
      }
      case 'cmd': {
        await handleCmd(msg.id, msg.site, msg.action, msg.input, msg.tab ?? 'active');
        break;
      }
      case 'pong': {
        break; // Keep-alive ack; nothing to track in M1.
      }
    }
  }

  /** Post a failure result, omitting `code` entirely when there is none. */
  function fail(id: string, error: string, code?: string): void {
    if (code === undefined) send({ type: 'result', id, ok: false, error });
    else send({ type: 'result', id, ok: false, error, code });
  }

  function errMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }

  /** Extract a postable code from a TabError (or anything carrying one). */
  function errCode(err: unknown): string | undefined {
    return validCode((err as { code?: unknown } | null | undefined)?.code);
  }

  /**
   * Resolve a visible tab for `site`: focus the first open one, else open the
   * site's start page and wait for it to load. Returns null when no tab could
   * be produced; throws the tab layer's TabError (TIMEOUT) when an opened tab
   * never finishes loading. Gmail keeps the exact M1 behavior (first tab, no
   * focusing, never opens one) so its results stay byte-identical.
   */
  async function resolveActiveTab(site: WorkerSite): Promise<number | null> {
    if (site === 'gmail') {
      const ids = await gmailTabs();
      return ids[0] ?? null;
    }
    let ids: number[];
    try {
      const found = await browser.tabs.query({ url: SITE_TAB_QUERY[site] });
      ids = found.map((t) => t.id).filter((id): id is number => typeof id === 'number');
    } catch {
      return null;
    }
    if (ids.length > 0) {
      try {
        await browser.tabs.update(ids[0]!, { active: true });
      } catch {
        // Closed between query and focus; sendMessage reports it below.
      }
      return ids[0]!;
    }
    let created: { id?: number };
    try {
      created = await browser.tabs.create({ url: SITE_START_URL[site], active: true });
    } catch {
      return null;
    }
    if (typeof created.id !== 'number') return null;
    await tabManager.waitForComplete(created.id);
    return created.id;
  }

  async function handleCmd(
    id: string,
    site: WorkerSite,
    action: string,
    input: unknown,
    tab: 'worker' | 'active',
  ): Promise<void> {
    // Background-handled action: never touches a content script.
    if (action === 'screenshot') {
      await handleScreenshot(id, site, input);
      return;
    }
    // The gmail+active path is M1-frozen: background-generated errors stay
    // codeless and byte-identical. Every other path carries codes; tab-reply
    // codes are forwarded on ALL paths (codeless replies stay identical).
    const legacy = site === 'gmail' && tab === 'active';
    let tabId: number;
    try {
      const resolved =
        tab === 'worker' ? await tabManager.getWorkerTab(site) : await resolveActiveTab(site);
      if (resolved === null) {
        fail(id, NO_TAB[site], legacy ? undefined : 'NOT_OPEN');
        return;
      }
      tabId = resolved;
    } catch (err) {
      fail(id, errMessage(err, TAB_SILENT_FOR[site]), legacy ? undefined : errCode(err));
      return;
    }
    let reply: unknown;
    try {
      reply = await browser.tabs.sendMessage(tabId, { type: 'cmd', id, action, input });
    } catch {
      fail(id, TAB_SILENT_FOR[site], legacy ? undefined : 'TIMEOUT');
      return;
    }
    const r = (reply ?? {}) as Record<string, unknown>;
    if (r['ok'] === true) send({ type: 'result', id, ok: true, output: r['output'] });
    else if (r['ok'] === false)
      fail(id, String(r['error'] ?? TAB_SILENT_FOR[site]), validCode(r['code']));
    else fail(id, TAB_SILENT_FOR[site], legacy ? undefined : 'TIMEOUT');
  }

  /**
   * Screenshot action (input `{ site, url? }`, handled in the background, not
   * by a content script). Navigates the site's worker tab to `url` when given,
   * captures it, and returns `{ dataUrl }`. Failures carry TIMEOUT (the tab
   * restore already happened inside captureScreenshot).
   */
  async function handleScreenshot(id: string, cmdSite: WorkerSite, input: unknown): Promise<void> {
    const inp = (input ?? {}) as Record<string, unknown>;
    const asked = inp['site'];
    const site: WorkerSite =
      asked === 'gmail' || asked === 'calendar' || asked === 'meta' ? asked : cmdSite;
    const rawUrl = inp['url'];
    const url = typeof rawUrl === 'string' ? rawUrl : undefined;
    try {
      const { dataUrl } = await tabManager.captureScreenshot(site, url);
      send({ type: 'result', id, ok: true, output: { dataUrl } });
    } catch (err) {
      fail(id, errMessage(err, 'Screenshot failed.'), errCode(err) ?? 'TIMEOUT');
    }
  }

  async function pair(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    connect();
    const opened = await waitForOpen(PAIR_TIMEOUT_MS);
    if (!opened) return { ok: false, error: NO_ANSWER };
    // Single-flight by replacement: one user, one popup; a second pair
    // supersedes the first (unreachable from the popup, which disables Pair
    // while busy — the stale caller gets told to retry, never hangs).
    if (pendingPair) {
      timers.clearTimeout(pendingPair.timer);
      pendingPair.resolve({ ok: false, error: NO_ANSWER });
    }
    return new Promise((resolve) => {
      const timer = timers.setTimeout(() => {
        if (pendingPair?.timer === timer) pendingPair = null;
        // Wrong codes fail silent server-side, so this timeout is also the
        // wrong-code path.
        resolve({ ok: false, error: NO_ANSWER });
      }, PAIR_TIMEOUT_MS);
      pendingPair = { resolve, timer };
      send({ type: 'pair', code });
    });
  }

  /**
   * Queue one trigger until the socket is open AND the hello is acked. A
   * click-after-idle wakes a fresh worker whose socket is still connecting;
   * sending immediately would no-op (or the server would drop the pre-auth
   * trigger), losing the first click silently.
   */
  async function sendTrigger(workflowId: unknown, email: unknown): Promise<void> {
    connect();
    const start = Date.now();
    const opened = await waitForOpen(TRIGGER_TIMEOUT_MS);
    // On timeout the trigger is DROPPED: 5s covers wake+hello in practice, a
    // second click always works (the socket is open+authed by then), and M1
    // keeps no persisted queue.
    if (!opened) return;
    const remaining = TRIGGER_TIMEOUT_MS - (Date.now() - start);
    if (remaining <= 0) return;
    const ready = await waitForReady(remaining);
    if (!ready) return;
    send({
      type: 'trigger',
      workflowId,
      triggerType: 'gmailButton',
      payload: email,
    });
  }

  /**
   * Local half of unpair (the popup calls the server revoke route first):
   * forget the token so the popup offers pairing again. The socket stays
   * open but unauthenticated — exactly what the next pair needs.
   */
  async function unpair(): Promise<{ ok: true }> {
    token = null;
    try {
      await browser.storage.local.remove(TOKEN_KEY);
    } catch {
      // Storage failure must not block the in-memory unpair; worst case the
      // stale token is re-read on the next boot and rejected by the server.
    }
    return { ok: true };
  }

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = (message ?? {}) as Record<string, unknown>;
    if (msg['action'] === 'pair') return pair(String(msg['code'] ?? ''));
    if (msg['action'] === 'unpair') return unpair();
    if (msg['action'] === 'status') {
      return { paired: token !== null, connected: isOpen() };
    }
    if (msg['action'] === 'trigger') {
      // Flat Task-9 shape: the content script's readOpenEmail object passes
      // through untouched as the trigger payload.
      return sendTrigger(msg['workflowId'], msg['email']);
    }
    if (msg['action'] === 'getButtons') {
      // Same shape as the fan-out so the content script reuses its
      // `buttons` handler. Cloned per call so a tab mutating its reply
      // cannot corrupt the cache for other tabs.
      return {
        type: 'buttons',
        items: lastButtons.map((i) => ({ workflowId: i.workflowId, label: i.label })),
      };
    }
    return undefined;
  });

  return {
    async boot(): Promise<void> {
      const stored = await browser.storage.local.get(TOKEN_KEY);
      const found = stored[TOKEN_KEY];
      token = typeof found === 'string' ? found : null;
      connect();
    },
    dispose(): void {
      disposed = true;
      clearPing();
      if (reconnectTimer !== null) {
        timers.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pendingPair) {
        timers.clearTimeout(pendingPair.timer);
        pendingPair = null;
      }
      openWaiters = [];
      readyWaiters = [];
      try {
        socket?.close();
      } catch {
        // Ignore close errors during teardown.
      }
      socket = null;
    },
  };
}
