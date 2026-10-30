import { describe, expect, it, vi } from 'vitest';
import { createTabManager, type TabLike, type TabsLike } from '../lib/tabs.js';

interface FakeTabsState {
  tabs: TabsLike;
  created: Array<{ url?: string; active?: boolean; pinned?: boolean }>;
  updated: Array<{ tabId: number; props: Record<string, unknown> }>;
}

/** Hand mock in the makeBrowser style: scripted tab list, recorded calls. */
function makeTabs(opts: { existing?: TabLike[]; capture?: string; captureThrows?: boolean } = {}) {
  const existing = opts.existing ?? [];
  const byId = new Map<number, TabLike>();
  for (const t of existing) {
    if (t.id !== undefined) byId.set(t.id, { ...t });
  }
  let nextId = 100;
  const created: FakeTabsState['created'] = [];
  const updated: FakeTabsState['updated'] = [];
  const tabs: TabsLike = {
    query: vi.fn(async (q: { url?: string; active?: boolean; currentWindow?: boolean }) => {
      if (q.active) return [{ id: 7, active: true, windowId: 1 }];
      if (q.url) {
        const prefix = q.url.replace(/\*$/, '');
        return [...byId.values()].filter((t) => t.url?.startsWith(prefix));
      }
      return [...byId.values()];
    }),
    get: vi.fn(async (tabId: number) => {
      const tab = byId.get(tabId);
      if (!tab) throw new Error('No tab with id');
      return { ...tab, status: 'complete' as const };
    }),
    create: vi.fn(async (props: { url?: string; active?: boolean; pinned?: boolean }) => {
      created.push(props);
      nextId += 1;
      const tab: TabLike = { id: nextId, url: props.url, status: 'complete' };
      byId.set(nextId, tab);
      return { ...tab };
    }),
    update: vi.fn(async (tabId: number, props: Record<string, unknown>) => {
      updated.push({ tabId, props });
      const tab = byId.get(tabId);
      if (tab && typeof props['url'] === 'string') tab.url = props['url'];
      return { id: tabId, status: 'complete' as const };
    }),
    captureVisibleTab: vi.fn(async () => {
      if (opts.captureThrows) throw new Error('capture failed');
      return opts.capture ?? 'data:image/png;base64,AAAA';
    }),
  };
  return { tabs, created, updated, byId };
}

describe('getWorkerTab', () => {
  it('called twice creates one pinned, inactive tab', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const first = await mgr.getWorkerTab('calendar');
    const second = await mgr.getWorkerTab('calendar');
    expect(first).toBe(second);
    expect(f.created).toHaveLength(1);
    expect(f.created[0]).toMatchObject({ pinned: true, active: false });
    expect(f.created[0]?.url).toContain('calendar.google.com');
  });

  it('recreates the tab when Dad closed it', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const first = await mgr.getWorkerTab('calendar');
    f.byId.delete(first); // Dad closed the worker tab.
    const second = await mgr.getWorkerTab('calendar');
    expect(second).not.toBe(first);
    expect(f.created).toHaveLength(2);
    // The new id is cached again.
    expect(await mgr.getWorkerTab('calendar')).toBe(second);
    expect(f.created).toHaveLength(2);
  });

  it('reuses an already-open matching tab instead of creating one', async () => {
    const f = makeTabs({ existing: [{ id: 55, url: 'https://calendar.google.com/calendar' }] });
    const mgr = createTabManager({ tabs: f.tabs });
    expect(await mgr.getWorkerTab('calendar')).toBe(55);
    expect(f.created).toHaveLength(0);
  });

  it('keeps one tab per site', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const cal = await mgr.getWorkerTab('calendar');
    const meta = await mgr.getWorkerTab('meta');
    expect(cal).not.toBe(meta);
    expect(f.created).toHaveLength(2);
  });
});

describe('captureScreenshot', () => {
  it('navigates to url, activates, captures, then restores the previous tab', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const workerId = await mgr.getWorkerTab('calendar');
    f.updated.length = 0;

    const result = await mgr.captureScreenshot(
      'calendar',
      'https://calendar.google.com/calendar/week',
    );

    expect(result).toEqual({ dataUrl: 'data:image/png;base64,AAAA' });
    // Navigated the worker tab to the requested URL.
    expect(f.updated).toContainEqual({
      tabId: workerId,
      props: { url: 'https://calendar.google.com/calendar/week' },
    });
    // Briefly activated the worker tab, then restored Dad's tab (id 7).
    const activations = f.updated.filter((u) => u.props['active'] === true);
    expect(activations.map((u) => u.tabId)).toEqual([workerId, 7]);
    expect(f.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('skips navigation when no url is given', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const workerId = await mgr.getWorkerTab('calendar');
    f.updated.length = 0;

    await mgr.captureScreenshot('calendar');

    expect(f.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
    expect(f.updated).toContainEqual({ tabId: workerId, props: { active: true } });
    expect(f.updated).toContainEqual({ tabId: 7, props: { active: true } });
  });

  it('restores the previous tab and throws TIMEOUT when capture fails', async () => {
    const f = makeTabs({ captureThrows: true });
    const mgr = createTabManager({ tabs: f.tabs });
    const err = await mgr.captureScreenshot('calendar').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: unknown }).code).toBe('TIMEOUT');
    // Dad's view is restored even on failure.
    expect(f.updated).toContainEqual({ tabId: 7, props: { active: true } });
  });

  it('throws TIMEOUT when the page never finishes loading', async () => {
    const f = makeTabs();
    f.tabs.get = vi.fn(async (tabId: number) => ({ id: tabId, status: 'loading' as const }));
    const mgr = createTabManager({
      tabs: f.tabs,
      sleep: async () => {},
      loadTimeoutMs: 30,
      loadPollMs: 5,
    });
    const err = await mgr
      .captureScreenshot('calendar', 'https://calendar.google.com/calendar/week')
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as { code?: unknown }).code).toBe('TIMEOUT');
  });
});
