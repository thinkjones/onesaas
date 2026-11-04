// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ControlPlane from '../entrypoints/sidepanel/ControlPlane.tsx';
import type { Automation } from '../lib/automations.js';
import type { PanelSite } from '../lib/sites.js';

const API = 'http://127.0.0.1:8787';

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

async function render(site: PanelSite | null = 'gmail', connected = true) {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ControlPlane, { site, connected, openApp, onOpenSettings }));
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
const banner = () => q('[data-testid="mode-banner"]');
const posts = (path: string) =>
  fetchMock.mock.calls.filter(([u, i]) => u === `${API}${path}` && i?.method === 'POST');

function type(text: string) {
  const el = q<HTMLTextAreaElement>('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function sendChat(text: string) {
  type(text);
  await act(async () => {
    button('Send').click();
  });
  await flush();
}

describe('call-to-action groups', () => {
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

describe('mode is always clear', () => {
  test('starts out designing a new automation', async () => {
    await render();
    expect(banner().getAttribute('data-mode')).toBe('design');
    expect(banner().textContent).toContain('Designing');
    expect(banner().textContent).toContain('New automation');
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
    expect(banner().getAttribute('data-mode')).toBe('run');
    expect(banner().textContent).toContain('Running');
    expect(banner().textContent).toContain('Save as lead');
    await act(async () => {
      finish({ body: { run: { id: 'r1', status: 'done' }, steps: [] } });
    });
    await flush();
    expect(banner().textContent).toContain('Finished');
    expect(banner().getAttribute('data-mode')).toBe('run');
  });

  test('clicking one that is not on designs it and starts no run', async () => {
    await render();
    await act(async () => {
      button('Half built').click();
    });
    await flush();
    expect(posts('/api/workflows/wf-draft/run')).toHaveLength(0);
    expect(banner().getAttribute('data-mode')).toBe('design');
    expect(banner().textContent).toContain('Half built');
  });

  test('designing a live automation warns that changes apply to its next run', async () => {
    await render();
    const select = q<HTMLSelectElement>('select');
    await act(async () => {
      select.value = 'wf-lead';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(banner().textContent).toContain('Save as lead');
    expect(banner().textContent).toContain('next run');
  });

  test('new automation clears back to designing something new', async () => {
    replies['POST /api/workflows/wf-lead/run'] = { body: { run: { id: 'r1', status: 'done' }, steps: [] } };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await act(async () => {
      q<HTMLButtonElement>('.list-toggle').click();
    });
    await act(async () => {
      button('Set up a new automation').click();
    });
    await flush();
    expect(banner().getAttribute('data-mode')).toBe('design');
    expect(banner().textContent).toContain('New automation');
  });

  test('sending from the chat after a run switches to designing that automation', async () => {
    replies['POST /api/workflows/wf-lead/run'] = { body: { run: { id: 'r1', status: 'done' }, steps: [] } };
    replies['POST /api/workflows/wf-lead/agent'] = { status: 202, body: {} };
    await render();
    await act(async () => {
      button('Save as lead').click();
    });
    await flush();
    await sendChat('Make the reply shorter');
    expect(banner().getAttribute('data-mode')).toBe('design');
    expect(banner().textContent).toContain('Save as lead');
    expect(posts('/api/workflows/wf-lead/agent')).toHaveLength(1);
    expect(container.textContent).toContain('Make the reply shorter');
  });
});

describe('running', () => {
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
    await emit({
      type: 'step',
      stepRun: { runId: 'r1', stepId: 'draft', status: 'running' },
    });
    const row = q('[data-step="draft"]');
    expect(row.getAttribute('data-status')).toBe('running');
    expect(row.textContent).toContain('Draft reply');
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

describe('designing', () => {
  test('a first message with nothing selected creates an automation, then sends', async () => {
    replies['POST /api/workflows'] = { body: { ...DRAFT, id: 'wf-new', name: 'Turn receipts into a sheet' } };
    replies['POST /api/workflows/wf-new/agent'] = { status: 202, body: {} };
    await render();
    await sendChat('Turn receipts into a sheet every Friday please');
    const created = JSON.parse(posts('/api/workflows')[0]![1].body as string);
    expect(created).toEqual({
      name: 'Turn receipts into a sheet every',
      description: 'Turn receipts into a sheet every Friday please',
    });
    const sent = posts('/api/workflows/wf-new/agent')[0]!;
    expect(JSON.parse(sent[1].body as string)).toEqual({
      text: 'Turn receipts into a sheet every Friday please',
    });
    expect(container.textContent).toContain('Turn receipts into a sheet every Friday please');
  });

  test('a selected automation is changed in place, with its history shown', async () => {
    replies['GET /api/workflows/wf-lead/agent'] = {
      body: [{ role: 'agent', text: 'Built your lead saver.', at: 1 }],
    };
    replies['POST /api/workflows/wf-lead/agent'] = { status: 202, body: {} };
    await render();
    const select = q<HTMLSelectElement>('select');
    await act(async () => {
      select.value = 'wf-lead';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain('Built your lead saver.');
    await sendChat('Add a thank you line');
    expect(posts('/api/workflows')).toHaveLength(0);
    expect(posts('/api/workflows/wf-lead/agent')).toHaveLength(1);
  });

  test('live agent replies and answer chips appear, and a chip sends its answer', async () => {
    replies['POST /api/workflows/wf-lead/agent'] = { status: 202, body: {} };
    await render();
    const select = q<HTMLSelectElement>('select');
    await act(async () => {
      select.value = 'wf-lead';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await sendChat('Change it');
    await emit({ type: 'agent', workflowId: 'wf-lead', event: { type: 'say', text: 'Sure thing.' } });
    await emit({
      type: 'agent',
      workflowId: 'wf-lead',
      event: { type: 'ask', question: 'Which tone?', options: ['Warm', 'Formal'] },
    });
    await emit({ type: 'agent', workflowId: 'other', event: { type: 'say', text: 'Not for you.' } });
    expect(container.textContent).toContain('Sure thing.');
    expect(container.textContent).not.toContain('Not for you.');
    await emit({ type: 'agent', workflowId: 'wf-lead', event: { type: 'done' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });
    await act(async () => {
      button('Warm').click();
    });
    await flush();
    const calls = posts('/api/workflows/wf-lead/agent');
    expect(JSON.parse(calls[calls.length - 1]![1].body as string)).toEqual({ text: 'Warm' });
  });

  test('send stays locked while the agent is working', async () => {
    replies['POST /api/workflows/wf-lead/agent'] = { status: 202, body: {} };
    await render();
    const select = q<HTMLSelectElement>('select');
    await act(async () => {
      select.value = 'wf-lead';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await sendChat('Change it');
    type('Another thing');
    expect(button('Send').disabled).toBe(true);
  });

  test('a failed send is removed and explained', async () => {
    replies['POST /api/workflows/wf-lead/agent'] = { status: 500, body: { error: 'Server broke.' } };
    await render();
    const select = q<HTMLSelectElement>('select');
    await act(async () => {
      select.value = 'wf-lead';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await sendChat('Change it');
    expect(container.textContent).toContain('Server broke.');
    expect(q('[data-testid="transcript"]').textContent).not.toContain('Change it');
    expect(q<HTMLTextAreaElement>('[aria-label="Chat message"]').value).toBe('Change it');
    expect(button('Send').disabled).toBe(false);
  });

  test('an unreachable app is explained', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.textContent).toContain("Can't reach the app");
  });
});
