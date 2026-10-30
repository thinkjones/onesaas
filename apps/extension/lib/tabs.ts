/**
 * Worker tabs + screenshots. Reads run in one pinned, inactive tab per site
 * so background work never moves Dad's view; screenshots briefly activate
 * that tab (captureVisibleTab needs a visible tab) and always restore the
 * previously-active tab afterwards, including on failure.
 *
 * Injectable `TabsLike` seam (same hand-mock style as lib/background.ts):
 * the entrypoint adapts the real WXT `browser.tabs`, tests drive
 * createTabManager directly with fakes.
 */

export type WorkerSite = 'gmail' | 'calendar' | 'meta';

export interface TabLike {
  id?: number;
  url?: string;
  status?: string;
  active?: boolean;
  windowId?: number;
}

export interface TabQuery {
  url?: string;
  active?: boolean;
  currentWindow?: boolean;
}

export interface TabsLike {
  query(query: TabQuery): Promise<TabLike[]>;
  /** Rejects or resolves undefined when no tab has the id. */
  get(tabId: number): Promise<TabLike | undefined>;
  create(props: { url?: string; active?: boolean; pinned?: boolean }): Promise<TabLike>;
  update(
    tabId: number,
    props: { url?: string; active?: boolean; pinned?: boolean },
  ): Promise<TabLike | undefined>;
  captureVisibleTab(windowId?: number): Promise<string>;
}

export const SITE_TAB_QUERY: Record<WorkerSite, string> = {
  gmail: 'https://mail.google.com/*',
  calendar: 'https://calendar.google.com/*',
  meta: 'https://business.facebook.com/*',
};

export const SITE_START_URL: Record<WorkerSite, string> = {
  gmail: 'https://mail.google.com/',
  calendar: 'https://calendar.google.com/calendar',
  meta: 'https://business.facebook.com/',
};

/** Extension-side error carrying a protocol result code for the server. */
export class TabError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TabError';
    this.code = code;
  }
}

export interface TabManager {
  /** One pinned, inactive tab per site, created on demand and reused. */
  getWorkerTab(site: WorkerSite): Promise<number>;
  /**
   * Screenshot the site's worker tab (navigating to `url` first when given).
   * Returns a PNG data URL. Failures carry code TIMEOUT.
   */
  captureScreenshot(site: WorkerSite, url?: string): Promise<{ dataUrl: string }>;
  /** Wait for a tab's status to read complete (also used for active-open). */
  waitForComplete(tabId: number): Promise<void>;
}

const DEFAULT_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_LOAD_POLL_MS = 250;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createTabManager(o: {
  tabs: TabsLike;
  sleep?: (ms: number) => Promise<void>;
  loadTimeoutMs?: number;
  loadPollMs?: number;
}): TabManager {
  const tabs = o.tabs;
  const sleep = o.sleep ?? defaultSleep;
  const loadTimeoutMs = o.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const loadPollMs = o.loadPollMs ?? DEFAULT_LOAD_POLL_MS;

  const cache = new Map<WorkerSite, number>();
  const inflight = new Map<WorkerSite, Promise<number>>();

  async function getWorkerTab(site: WorkerSite): Promise<number> {
    const running = inflight.get(site);
    if (running !== undefined) return running;
    const p = resolveWorkerTab(site).finally(() => {
      if (inflight.get(site) === p) inflight.delete(site);
    });
    inflight.set(site, p);
    return p;
  }

  async function resolveWorkerTab(site: WorkerSite): Promise<number> {
    // Re-query the cached id: Dad may have closed the tab since it was cached.
    const cached = cache.get(site);
    if (cached !== undefined) {
      try {
        const tab = await tabs.get(cached);
        if (tab?.id === cached) return cached;
      } catch {
        // Closed (or otherwise gone): fall through and recreate.
      }
      cache.delete(site);
    }
    // A matching tab may already be open (e.g. background restarted and lost
    // the cache): reuse it instead of opening a duplicate.
    try {
      const open = await tabs.query({ url: SITE_TAB_QUERY[site] });
      const reuse = open.map((t) => t.id).find((id): id is number => typeof id === 'number');
      if (reuse !== undefined) {
        cache.set(site, reuse);
        return reuse;
      }
    } catch {
      // Query failure must not block creation below.
    }
    let created: TabLike;
    try {
      created = await tabs.create({ url: SITE_START_URL[site], pinned: true, active: false });
    } catch (err) {
      throw new TabError('NOT_OPEN', `Could not open a background tab: ${(err as Error).message}`);
    }
    if (typeof created.id !== 'number') {
      throw new TabError('NOT_OPEN', 'Could not open a background tab.');
    }
    cache.set(site, created.id);
    return created.id;
  }

  async function waitForComplete(tabId: number): Promise<void> {
    const start = Date.now();
    for (;;) {
      let status: string | undefined;
      try {
        const tab = await tabs.get(tabId);
        if (tab === undefined) throw new TabError('TIMEOUT', 'The tab closed while loading.');
        status = tab.status;
      } catch (err) {
        if (err instanceof TabError) throw err;
        throw new TabError('TIMEOUT', 'The tab closed while loading.');
      }
      if (status === 'complete') return;
      if (Date.now() - start >= loadTimeoutMs) {
        throw new TabError('TIMEOUT', 'The page took too long to load.');
      }
      await sleep(loadPollMs);
    }
  }

  async function captureScreenshot(site: WorkerSite, url?: string): Promise<{ dataUrl: string }> {
    const tabId = await getWorkerTab(site);
    if (url !== undefined) {
      try {
        await tabs.update(tabId, { url });
      } catch (err) {
        throw new TabError('TIMEOUT', `Could not open the page: ${(err as Error).message}`);
      }
      await waitForComplete(tabId);
    }
    // captureVisibleTab needs a VISIBLE tab: briefly activate the worker tab,
    // then restore whatever Dad was looking at — on every path, hence the
    // try/finally (restore failures are swallowed: Dad's tab may have closed).
    let previous: number | undefined;
    try {
      const active = await tabs.query({ active: true, currentWindow: true });
      const id = active[0]?.id;
      previous = typeof id === 'number' && id !== tabId ? id : undefined;
    } catch {
      previous = undefined;
    }
    try {
      await tabs.update(tabId, { active: true });
      const dataUrl = await tabs.captureVisibleTab();
      return { dataUrl };
    } catch (err) {
      if (err instanceof TabError) throw err;
      throw new TabError('TIMEOUT', `Screenshot failed: ${(err as Error).message}`);
    } finally {
      if (previous !== undefined) {
        try {
          await tabs.update(previous, { active: true });
        } catch {
          // Dad closed the tab mid-capture; nothing to restore.
        }
      }
    }
  }

  return { getWorkerTab, captureScreenshot, waitForComplete };
}
