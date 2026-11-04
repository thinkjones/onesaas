// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ControlPlane from '../entrypoints/sidepanel/ControlPlane.tsx';
import type { Automation } from '../lib/automations.js';
import type { PanelSite } from '../lib/sites.js';

const API = 'http://127.0.0.1:8787';

const readActivePage = vi.hoisted(() => vi.fn());
vi.mock('../lib/pageText.js', () => ({ readActivePage }));

const LEAD: Automation = {
  id: 'wf-lead',
  name: 'Save as lead',
  status: 'on',
  trigger: { id: 'trigger', type: 'trigger.gmailButton', title: 'Gmail button', config: {} },
  steps: [
    { id: 'approve', type: 'approval.ask', title: 'Check the reply', config: { question: 'Send this?' } },
    { id: 'draft', type: 'gmail.draftReply', title: 'Draft reply', config: {} },
  ],
};
const POSTS: Automation = {
  id: 'wf-posts',
  name: 'Photo posts',
  status: 'on',
  trigger: { id: 'trigger', type: 'trigger.upload', title: 'Upload', config: {} },
  steps: [{ id: 'post', type: 'meta.draftPost', title: 'Draft post', config: {} }],
};
const DRAFT: Automation = {
  id: 'wf-draft',
  name: 'Half built',
  status: 'draft',
  trigger: { id: 'trigger', type: 'trigger.manual', title: 'Manual', config: {} },
  steps: [],
};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

function emit(data: unknown) {
  return act(async () => {
    FakeEventSource.last!.onmessage!({ data: JSON.stringify(data) });
  });
}

type Reply = { status?: number; body?: unknown };
let replies: Record<string, Reply | (() => Reply | Promise<Reply>)>;
let fetchMock: ReturnType<typeof vi.fn>;
let openApp: ReturnType<typeof vi.fn>;
let onOpenSettings: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

beforeEach(() => {
  replies = { 'GET /api/workflows': { body: [LEAD, POSTS, DRAFT] } };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(API, '')}`;
    const entry = replies[key];
    const reply = typeof entry === 'function' ? await entry() : (entry ?? { body: [] });
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
  openApp = vi.fn(async () => {});
  onOpenSettings = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(site: PanelSite | null = 'gmail', connected = true, stepPace = () => 0) {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ControlPlane, { site, connected, openApp, onOpenSettings, stepPace }));
  });
  await flush();
}

const q = <T extends Element>(sel: string) => {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`${sel} missing: ${container.innerHTML}`);
  return el;
};
const group = (label: string) => q(`[aria-label="${label}"]`);
const button = (text: string, within: Element = container) => {
  const el = [...within.querySelectorAll('button')].find(
    (b) => b.textContent?.includes(text) || b.getAttribute('aria-label') === text,
  );
  if (!el) throw new Error(`button "${text}" missing: ${container.innerHTML}`);
  return el;
};
const banner = () => q('[data-testid="run-banner"]');
const posts = (path: string) =>
  fetchMock.mock.calls.filter(([u, i]) => u === `${API}${path}` && i?.method === 'POST');

describe('call-to-action groups', () => {
  test('coming back to the panel picks up automations made in the app', async () => {
    await render();
    expect(container.textContent).not.toContain('Made in the app');
    replies['GET /api/workflows'] = { body: [{ ...LEAD, id: 'wf-new', name: 'Made in the app' }] };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(container.textContent).toContain('Made in the app');
  });

  test('puts automations in the group for the current page, then the new-automation action', async () => {
    await render('gmail');
    expect(group('Automations for this page').textContent).toContain('Save as lead');
    expect(group('Automations for this page').textContent).not.toContain('Photo posts');
    expect(group('Your other automations').textContent).toContain('Photo posts');
    button('Set up a new automation');
  });

  test('says so when nothing fits this page', async () => {
    await render(null);
    expect(group('Automations for this page').textContent).toContain('Nothing for this page yet');
  });

  test('the gear opens settings', async () => {
    await render();
    await act(async () => {
      q<HTMLButtonElement>('button[aria-label="Settings"]').click();
    });
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('running an automation', () => {
  test('there is no chat, and no way to change anything', async () => {
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('Design');
  });

  test('a manual automation sends the page, and says when it could not read one', async () => {
    const job: Automation = { ...DRAFT, id: 'wf-job', name: 'Log job', status: 'on' };
    replies['GET /api/workflows'] = { body: [job] };
    replies['POST /api/workflows/wf-job/run'] = { body: { run: { id: 'r1', status: 'done' }, steps: [] } };
    const page = { url: 'https://example.com/job', title: 'Job', text: 'Pastry chef' };
    readActivePage.mockResolvedValueOnce(page);
    await render();
    await act(async () => {
      button('Log job').click();
    });
    await flush();
    expect(JSON.parse(posts('/api/workflows/wf-job/run')[0]![1]!.body as string)).toEqual({ page });
    expect(container.textContent).not.toContain("couldn't read this page");

    readActivePage.mockResolvedValueOnce(null);
    await act(async () => {
      button('Close').click();
    });
    await act(async () => {
      button('Log job').click();
    });
    await flush();
    expect(posts('/api/workflows/wf-job/run')[1]![1]!.body).toBeUndefined();
    expect(container.textContent).toContain("couldn't read this page");
  });

  test('clicking an automation that is on runs it for real and says so', async () => {
    let finish!: (r: Reply) => void;
    replies['POST /api/workflows/wf-lead/run'] = () => new Promise<Reply>((r) => (finish = r));
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    expect(posts('/api/workflows/wf-lead/run')).toHaveLength(1);
    expect(banner().textContent).toContain('Running');
    expect(banner().textContent).toContain('Save as lead');
    await act(async () => {
      finish({ body: { run: { id: 'r1', status: 'done' }, steps: [] } });
    });
    await flush();
    expect(banner().textContent).toContain('Finished');
  });

  test('an automation that is not published does not show', async () => {
    await render();
    expect(container.textContent).toContain('Save as lead');
    expect(container.textContent).not.toContain('Half built');
  });

  test('setting up a new automation happens in the app', async () => {
    await render();
    await act(async () => {
      button('Set up a new automation').click();
    });
    expect(openApp).toHaveBeenCalledWith('/automate');
  });

  test('a finished run links to its results, and Close goes back to the list', async () => {
    replies['POST /api/workflows/wf-lead/run'] = { body: { run: { id: 'r1', status: 'done' }, steps: [] } };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await act(async () => {
      button('See this run in the app').click();
    });
    expect(openApp).toHaveBeenCalledWith('/automations/wf-lead?mode=runs&run=r1');
    await act(async () => {
      button('Close').click();
    });
    expect(group('Automations for this page').textContent).toContain('Save as lead');
  });
});

describe('running', () => {
  test('a step that saved something links to that record', async () => {
    const saves: Automation = {
      ...LEAD,
      steps: [{ id: 'save', type: 'table.insert', title: 'Save job', config: { table: 'job applications' } }],
    };
    replies['GET /api/workflows'] = { body: [saves] };
    replies['POST /api/workflows/wf-lead/run'] = {
      body: {
        run: { id: 'r1', status: 'done' },
        steps: [
          { stepId: 'trigger', status: 'done' },
          { stepId: 'save', status: 'done', output: { id: 42 } },
        ],
      },
    };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await act(async () => {
      button('See the saved record').click();
    });
    expect(openApp).toHaveBeenCalledWith('/lists?table=job%20applications&row=42');
  });

  test('a fast run still shows one step working at a time, for the set pace', async () => {
    vi.useFakeTimers();
    try {
      replies['POST /api/workflows/wf-lead/run'] = {
        body: {
          run: { id: 'r1', status: 'done' },
          steps: [
            { stepId: 'trigger', status: 'done', why: 'You clicked.' },
            { stepId: 'approve', status: 'done', why: 'You said yes.' },
            { stepId: 'draft', status: 'done', why: 'Drafted.' },
          ],
        },
      };
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(ControlPlane, { site: 'gmail', connected: true, openApp, onOpenSettings, stepPace: () => 1500 }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        button('Save as lead').click();
        await vi.advanceTimersByTimeAsync(0);
      });
      const statuses = () => ['trigger', 'approve', 'draft'].map((id) => q(`[data-step="${id}"]`).getAttribute('data-status'));
      expect(statuses()).toEqual(['running', 'pending', 'pending']);
      expect(banner().textContent).toContain('Running');
      expect(container.textContent).not.toContain('You clicked.');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(statuses()).toEqual(['done', 'running', 'pending']);
      for (let i = 0; i < 2; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1500);
        });
      }
      expect(statuses()).toEqual(['done', 'done', 'done']);
      expect(banner().textContent).toContain('Finished');
    } finally {
      vi.useRealTimers();
    }
  });

  test('steps run in flow order, not the order they were added', async () => {
    const shuffled: Automation = {
      ...LEAD,
      steps: [LEAD.steps[1]!, LEAD.steps[0]!],
      edges: [
        { from: 'trigger', to: 'approve' },
        { from: 'approve', to: 'draft' },
      ],
    };
    replies['GET /api/workflows'] = { body: [shuffled] };
    replies['POST /api/workflows/wf-lead/run'] = () => new Promise<Reply>(() => {});
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    expect([...container.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'))).toEqual([
      'trigger',
      'approve',
      'draft',
    ]);
  });

  test('shows live step progress from the event stream', async () => {
    replies['POST /api/workflows/wf-lead/run'] = () => new Promise<Reply>(() => {});
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await emit({
      type: 'run',
      run: { id: 'r1', workflowId: 'wf-lead', status: 'running', kind: 'live' },
    });
    expect(q('[data-step="trigger"]').getAttribute('data-status')).toBe('running');
    for (const stepId of ['trigger', 'approve']) {
      await emit({ type: 'step', stepRun: { runId: 'r1', stepId, status: 'done' } });
      await flush();
    }
    const row = q('[data-step="draft"]');
    expect(row.getAttribute('data-status')).toBe('running');
    expect(row.textContent).toContain('Draft reply');
    expect(row.textContent).toContain('Working…');
  });

  test('ignores step events from other runs', async () => {
    replies['POST /api/workflows/wf-lead/run'] = () => new Promise<Reply>(() => {});
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await emit({ type: 'run', run: { id: 'r1', workflowId: 'wf-lead', status: 'running', kind: 'live' } });
    await emit({ type: 'run', run: { id: 'r2', workflowId: 'wf-other', status: 'running', kind: 'live' } });
    await emit({ type: 'step', stepRun: { runId: 'r2', stepId: 'draft', status: 'failed', error: 'boom' } });
    expect(q('[data-step="draft"]').getAttribute('data-status')).toBe('pending');
  });

  test('a refused run shows why', async () => {
    replies['POST /api/workflows/wf-lead/run'] = {
      status: 409,
      body: { error: 'Open an email in Gmail first, then press Run.' },
    };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    expect(container.textContent).toContain('Open an email in Gmail first');
    expect(banner().textContent).toContain("Couldn't run");
  });

  test('a failed step shows its error', async () => {
    replies['POST /api/workflows/wf-lead/run'] = {
      body: {
        run: { id: 'r1', status: 'failed' },
        steps: [{ runId: 'r1', stepId: 'draft', status: 'failed', error: 'Gmail is closed.' }],
      },
    };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    expect(banner().textContent).toContain('Needs a look');
    expect(q('[data-step="draft"]').textContent).toContain('Gmail is closed.');
  });

  test('a parked approval can be approved from the panel', async () => {
    replies['POST /api/workflows/wf-lead/run'] = {
      body: {
        run: { id: 'r1', status: 'waiting' },
        steps: [
          { runId: 'r1', stepId: 'approve', status: 'waiting', output: { proposed: { text: 'Hi Priya' } } },
        ],
      },
    };
    replies['POST /api/runs/r1/steps/approve/approval'] = {
      body: { run: { id: 'r1', status: 'done' }, steps: [] },
    };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    expect(banner().textContent).toContain('Waiting for you');
    expect(container.textContent).toContain('Send this?');
    expect(q<HTMLTextAreaElement>('[aria-label="Proposed text"]').value).toBe('Hi Priya');
    await act(async () => {
      button('Looks good').click();
    });
    await flush();
    const call = posts('/api/runs/r1/steps/approve/approval')[0]!;
    expect(JSON.parse(call[1].body as string)).toEqual({ action: 'approve' });
    expect(banner().textContent).toContain('Finished');
  });

  test('changed approval text is sent as an edit', async () => {
    replies['POST /api/workflows/wf-lead/run'] = {
      body: {
        run: { id: 'r1', status: 'waiting' },
        steps: [
          { runId: 'r1', stepId: 'approve', status: 'waiting', output: { proposed: { text: 'Hi Priya' } } },
        ],
      },
    };
    replies['POST /api/runs/r1/steps/approve/approval'] = {
      body: { run: { id: 'r1', status: 'done' }, steps: [] },
    };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    const box = q<HTMLTextAreaElement>('[aria-label="Proposed text"]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      set.call(box, 'Hello Priya');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      button('Looks good').click();
    });
    await flush();
    const call = posts('/api/runs/r1/steps/approve/approval')[0]!;
    expect(JSON.parse(call[1].body as string)).toEqual({ action: 'edit', text: 'Hello Priya' });
  });

  test('a photo automation asks for a photo and uses the upload route', async () => {
    replies['POST /api/workflows/wf-posts/upload'] = {
      body: { run: { id: 'r2', status: 'done' }, file: {} },
    };
    replies['GET /api/runs/r2'] = { body: { run: { id: 'r2', status: 'done' }, steps: [] } };
    await render('meta');
    const input = q<HTMLInputElement>('input[type="file"]');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    await act(async () => {
      button('Photo posts').click();
    });
    expect(click).toHaveBeenCalled();
    expect(posts('/api/workflows/wf-posts/upload')).toHaveLength(0);
    const file = new File(['x'], 'mug.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(posts('/api/workflows/wf-posts/upload')).toHaveLength(1);
    expect(banner().textContent).toContain('Finished');
  });
});
