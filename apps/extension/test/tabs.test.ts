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
  // Active tab per window, like the real browser: the owner starts on tab 7 in
  // window 1, and update({active:true}) moves activation (so the
  // pre-capture verification query sees the just-activated worker tab).
  const activeByWindow = new Map<number, number>([[1, 7]]);
  const tabs: TabsLike = {
    query: vi.fn(
      async (q: { url?: string; active?: boolean; currentWindow?: boolean; windowId?: number }) => {
        if (q.active) {
          const win = q.windowId ?? 1;
          const id = activeByWindow.get(win);
          return id === undefined ? [] : [{ id, active: true, windowId: win }];
        }
        if (q.url) {
          const prefix = q.url.replace(/\*$/, '');
          return [...byId.values()].filter((t) => t.url?.startsWith(prefix));
        }
        return [...byId.values()];
      },
    ),
    get: vi.fn(async (tabId: number) => {
      const tab = byId.get(tabId);
      if (!tab) throw new Error('No tab with id');
      return { ...tab, status: 'complete' as const };
    }),
    create: vi.fn(async (props: { url?: string; active?: boolean; pinned?: boolean }) => {
      created.push(props);
      nextId += 1;
      const tab: TabLike = { id: nextId, url: props.url, status: 'complete', windowId: 1 };
      byId.set(nextId, tab);
      return { ...tab };
    }),
    update: vi.fn(async (tabId: number, props: Record<string, unknown>) => {
      updated.push({ tabId, props });
      const tab = byId.get(tabId);
      if (tab && typeof props['url'] === 'string') tab.url = props['url'];
      if (props['active'] === true) activeByWindow.set(tab?.windowId ?? 1, tabId);
      return { id: tabId, status: 'complete' as const };
    }),
    captureVisibleTab: vi.fn(async () => {
      if (opts.captureThrows) throw new Error('capture failed');
      return opts.capture ?? 'data:image/png;base64,AAAA';
    }),
  };
  return {
    tabs,
    created,
    updated,
    byId,
    setActive: (windowId: number, tabId: number) => activeByWindow.set(windowId, tabId),
  };
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

  it('recreates the tab when the owner closed it', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const first = await mgr.getWorkerTab('calendar');
    f.byId.delete(first); // The owner closed the worker tab.
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
    // Briefly activated the worker tab, then restored the owner's tab (id 7).
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
    // The owner's view is restored even on failure.
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

describe('captureScreenshot window targeting', () => {
  it('captures the worker tab window (not the current window) and restores its tab', async () => {
    const f = makeTabs({
      existing: [{ id: 55, url: 'https://calendar.google.com/calendar', windowId: 2 }],
    });
    f.setActive(2, 9); // Window B: the owner is on tab 9; window A (current): tab 7.
    const mgr = createTabManager({ tabs: f.tabs });

    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/week');

    // The capture targets window B.
    expect(f.tabs.captureVisibleTab).toHaveBeenCalledWith(2);
    // Previous-tab lookup + restore are scoped to window B, not window A.
    const queries = vi.mocked(f.tabs.query).mock.calls.map((c) => c[0]);
    expect(queries).toContainEqual({ active: true, windowId: 2 });
    expect(queries).not.toContainEqual({ active: true, currentWindow: true });
    const activations = f.updated.filter((u) => u.props['active'] === true);
    expect(activations.map((u) => u.tabId)).toEqual([55, 9]);
  });
});

describe('captureScreenshot serialization', () => {
  it('serializes concurrent captures on the same site in call order', async () => {
    const f = makeTabs();
    const events: string[] = [];
    const origUpdate = f.tabs.update;
    f.tabs.update = vi.fn(async (tabId: number, props: Record<string, unknown>) => {
      if (typeof props['url'] === 'string') events.push(`nav:${props['url']}`);
      return origUpdate(tabId, props as { url?: string; active?: boolean });
    });
    const shots = ['data:image/png;P', 'data:image/png;Q'];
    f.tabs.captureVisibleTab = vi.fn(async () => {
      const shot = shots.shift()!;
      events.push(`capture:${shot}`);
      return shot;
    });
    const mgr = createTabManager({ tabs: f.tabs });

    const p1 = mgr.captureScreenshot('calendar', 'https://calendar.google.com/calP');
    const p2 = mgr.captureScreenshot('calendar', 'https://calendar.google.com/calQ');
    const [r1, r2] = await Promise.all([p1, p2]);

    // Each caller gets its own screenshot.
    expect(r1).toEqual({ dataUrl: 'data:image/png;P' });
    expect(r2).toEqual({ dataUrl: 'data:image/png;Q' });
    // Serialized in call order: the second navigation only starts after the
    // first capture finished.
    expect(events).toEqual([
      'nav:https://calendar.google.com/calP',
      'capture:data:image/png;P',
      'nav:https://calendar.google.com/calQ',
      'capture:data:image/png;Q',
    ]);
  });

  it('a failed capture does not wedge the next one on the same site', async () => {
    const f = makeTabs();
    let calls = 0;
    f.tabs.captureVisibleTab = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('capture failed');
      return 'data:image/png;second';
    });
    const mgr = createTabManager({ tabs: f.tabs });

    const p1 = mgr.captureScreenshot('calendar', 'https://calendar.google.com/calP');
    const p2 = mgr.captureScreenshot('calendar', 'https://calendar.google.com/calQ');
    const [s1, s2] = await Promise.allSettled([p1, p2]);

    expect(s1.status).toBe('rejected');
    expect((s1 as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((s1 as PromiseRejectedResult).reason as { code?: unknown }).code).toBe('TIMEOUT');
    expect(s2).toEqual({ status: 'fulfilled', value: { dataUrl: 'data:image/png;second' } });
    expect(f.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
  });
});

describe('captureScreenshot pre-capture verification', () => {
  it('fails TIMEOUT without capturing when the active tab changes before capture', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    // The owner switches tabs in the activate→capture window: the previous-tab
    // lookup still sees 7, but the verification query sees 99.
    const activeReplies: TabLike[][] = [
      [{ id: 7, active: true, windowId: 1 }],
      [{ id: 99, active: true, windowId: 1 }],
    ];
    const origQuery = f.tabs.query;
    f.tabs.query = vi.fn(
      async (q: { url?: string; active?: boolean; currentWindow?: boolean; windowId?: number }) => {
        if (q.active && activeReplies.length > 0) return activeReplies.shift()!;
        return origQuery(q);
      },
    );

    const err = await mgr
      .captureScreenshot('calendar', 'https://calendar.google.com/calendar/week')
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect((err as { code?: unknown }).code).toBe('TIMEOUT');
    expect(f.tabs.captureVisibleTab).not.toHaveBeenCalled();
    // The owner's tab is still restored.
    expect(f.updated).toContainEqual({ tabId: 7, props: { active: true } });
  });
});

describe('captureScreenshot stale-page rule', () => {
  it('navigates a never-navigated tab to the site start URL when url is omitted', async () => {
    const f = makeTabs({
      existing: [{ id: 55, url: 'https://calendar.google.com/calendar/week', windowId: 1 }],
    });
    const mgr = createTabManager({ tabs: f.tabs });

    await mgr.captureScreenshot('calendar');

    expect(f.updated).toContainEqual({
      tabId: 55,
      props: { url: 'https://calendar.google.com/calendar' },
    });
  });

  it('does not re-navigate when url is omitted after navigating to P', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/week');
    f.updated.length = 0;

    await mgr.captureScreenshot('calendar');

    expect(f.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
  });

  it('navigates to Q when url Q differs from the last-navigated URL', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const workerId = await mgr.getWorkerTab('calendar');
    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/week');
    f.updated.length = 0;

    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/day');

    expect(f.updated).toContainEqual({
      tabId: workerId,
      props: { url: 'https://calendar.google.com/calendar/day' },
    });
  });

  it('skips navigation when url equals the last-navigated URL', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/week');
    f.updated.length = 0;

    await mgr.captureScreenshot('calendar', 'https://calendar.google.com/calendar/week');

    expect(f.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
    expect(f.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
  });
});

describe('navigateWorkerTab', () => {
  it('navigates the worker tab to the url and waits for it to load', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const url = 'https://mail.google.com/mail/u/0/#all/thread_abc123';

    const tabId = await mgr.navigateWorkerTab('gmail', url);

    expect(f.created).toHaveLength(1);
    expect(tabId).toBeGreaterThan(100);
    expect(f.updated).toContainEqual({ tabId, props: { url } });
    expect(f.tabs.get).toHaveBeenCalledWith(tabId);
  });

  it('skips navigation when the worker tab already shows the url', async () => {
    const f = makeTabs();
    const mgr = createTabManager({ tabs: f.tabs });
    const url = 'https://mail.google.com/mail/u/0/#all/thread_abc123';
    await mgr.navigateWorkerTab('gmail', url);
    f.updated.length = 0;

    const tabId = await mgr.navigateWorkerTab('gmail', url);

    expect(f.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
    expect(tabId).toBeGreaterThan(100);
  });

  it('a later screenshot shares the last-navigated url (no double navigate)', async () => {
    const f = makeTabs({ existing: [{ id: 7, active: true, windowId: 1 }] });
    const mgr = createTabManager({ tabs: f.tabs });
    const url = 'https://mail.google.com/mail/u/0/#all/thread_abc123';
    const tabId = await mgr.navigateWorkerTab('gmail', url);
    f.updated.length = 0;

    await mgr.captureScreenshot('gmail', url);

    expect(f.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
    expect(tabId).toBeGreaterThan(0);
  });
});
