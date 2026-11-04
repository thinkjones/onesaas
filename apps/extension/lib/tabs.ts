/**
 * Worker tabs + screenshots. Reads run in one pinned, inactive tab per site
 * so background work never moves the owner's view; screenshots briefly activate
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
  windowId?: number;
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
   * Navigate the site's worker tab to `url` (skipped when it already shows
   * it) and wait for it to load. Shares lastUrl with screenshots, so a read
   * followed by a capture of the same page navigates once. Failures carry
   * code TIMEOUT.
   */
  navigateWorkerTab(site: WorkerSite, url: string): Promise<number>;
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
  // Per-site tail of the capture promise chain: captures on one site run one
  // at a time so concurrent workflows can't interleave navigate/activate/
  // capture on the shared worker tab. The stored tail never rejects (a failed
  // capture must not wedge later ones); each caller still gets its own
  // promise, which rejects with that capture's real error.
  const captureChains = new Map<WorkerSite, Promise<unknown>>();
  // Last URL each worker tab was navigated to by us (seeded when we create
  // the tab, updated on every navigate). Absent = a reused tab whose page we
  // never chose: capturing it blind would serve a stale page.
  const lastUrl = new Map<number, string>();

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
    // Re-query the cached id: the owner may have closed the tab since it was cached.
    const cached = cache.get(site);
    if (cached !== undefined) {
      try {
        const tab = await tabs.get(cached);
        if (tab?.id === cached) return cached;
      } catch {
        // Closed (or otherwise gone): fall through and recreate.
      }
      cache.delete(site);
      lastUrl.delete(cached);
    }
    // A matching tab may already be open (e.g. background restarted and lost
    // the cache): reuse it instead of opening a duplicate. Its page is NOT
    // recorded in lastUrl: capture treats it as unknown and navigates to a
    // known page rather than photographing whatever it last showed.
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
    // We chose this tab's page, so it is a known (non-stale) starting point.
    if (typeof created.url === 'string') lastUrl.set(created.id, created.url);
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

  async function navigateWorkerTab(site: WorkerSite, url: string): Promise<number> {
    const tabId = await getWorkerTab(site);
    // Same-page re-reads stay cheap; the lastUrl write keeps screenshots of
    // the same page from navigating again.
    if (lastUrl.get(tabId) !== url) {
      try {
        await tabs.update(tabId, { url });
      } catch (err) {
        throw new TabError('TIMEOUT', `Could not open the page: ${(err as Error).message}`);
      }
      lastUrl.set(tabId, url);
      await waitForComplete(tabId);
    }
    return tabId;
  }

  function captureScreenshot(site: WorkerSite, url?: string): Promise<{ dataUrl: string }> {
    const prev = captureChains.get(site) ?? Promise.resolve();
    // Chain on settled (both branches run the capture) so one failure never
    // wedges the site; the caller gets `next`, which carries its own result.
    const next = prev.then(
      () => captureInner(site, url),
      () => captureInner(site, url),
    );
    captureChains.set(
      site,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async function captureInner(site: WorkerSite, url?: string): Promise<{ dataUrl: string }> {
    const tabId = await getWorkerTab(site);
    // The worker tab may live in any window, but captureVisibleTab with no
    // arg photographs the CURRENT window: resolve the tab's window and aim
    // the capture (and the previous-tab lookup/restore) at that window.
    let windowId: number | undefined;
    try {
      const self = await tabs.get(tabId);
      windowId = typeof self?.windowId === 'number' ? self.windowId : undefined;
    } catch {
      throw new TabError('TIMEOUT', 'The tab closed before the screenshot.');
    }
    const activeQuery: TabQuery =
      windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId };
    // Stale-page rule: navigate when a url is given and differs from what we
    // last put in this tab; when url is omitted, capture as-is EXCEPT on a
    // tab whose page we never chose (reused open tab), which first navigates
    // to the site start URL. Same-page re-reads stay cheap, reused tabs never
    // serve a stale page.
    const last = lastUrl.get(tabId);
    const target = url ?? (last === undefined ? SITE_START_URL[site] : undefined);
    if (target !== undefined && target !== last) {
      try {
        await tabs.update(tabId, { url: target });
      } catch (err) {
        throw new TabError('TIMEOUT', `Could not open the page: ${(err as Error).message}`);
      }
      lastUrl.set(tabId, target);
      await waitForComplete(tabId);
    }
    // captureVisibleTab needs a VISIBLE tab: briefly activate the worker tab,
    // then restore whatever the owner was looking at — on every path, hence the
    // try/finally (restore failures are swallowed: the owner's tab may have closed).
    let previous: number | undefined;
    try {
      const active = await tabs.query(activeQuery);
      const id = active[0]?.id;
      previous = typeof id === 'number' && id !== tabId ? id : undefined;
    } catch {
      previous = undefined;
    }
    try {
      await tabs.update(tabId, { active: true });
      // The owner may have switched tabs in the activate→capture window: re-check
      // the active tab in the target window and fail instead of capturing a
      // stranger tab as success.
      let stillActive: TabLike[];
      try {
        stillActive = await tabs.query(activeQuery);
      } catch {
        throw new TabError('TIMEOUT', 'Could not verify the tab before the screenshot.');
      }
      if (stillActive[0]?.id !== tabId) {
        throw new TabError('TIMEOUT', 'The tab changed before the screenshot.');
      }
      const dataUrl = await tabs.captureVisibleTab(windowId);
      return { dataUrl };
    } catch (err) {
      if (err instanceof TabError) throw err;
      throw new TabError('TIMEOUT', `Screenshot failed: ${(err as Error).message}`);
    } finally {
      if (previous !== undefined) {
        try {
          await tabs.update(previous, { active: true });
        } catch {
          // The owner closed the tab mid-capture; nothing to restore.
        }
      }
    }
  }

  return { getWorkerTab, navigateWorkerTab, captureScreenshot, waitForComplete };
}
