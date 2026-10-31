import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Explain, { AltClickExplainRoot } from './Explain.tsx';

// M5 Task 6: the "?" button opens a popover with the plain-English
// explanation; "Tell me more" sends "Tell me more about <label>" to the
// agent; alt-clicking any [data-explain] element opens the same popover.

const EXPLAIN_TEXT = 'This step writes a friendly reply draft for each customer email.';

function stubExplainFetch() {
  const posts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/explain' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      // STRICT like the server's ExplainBody: view fields (label, x, y)
      // riding along must fail loudly, not slip through.
      for (const key of Object.keys(body)) {
        if (key !== 'kind' && key !== 'id' && key !== 'context') {
          throw new Error(`explain stub: surplus key ${JSON.stringify(key)} (server 400s)`);
        }
      }
      posts.push(body);
      return { ok: true, status: 200, json: async () => ({ text: EXPLAIN_TEXT }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { posts };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Explain', () => {
  test('the popover shows the returned text', async () => {
    stubExplainFetch();
    render(
      <Explain
        target={{ kind: 'step', id: 'write', context: 'wf-1' }}
        label="Write reply"
        onTellMeMore={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain Write reply' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
  });

  test('"Tell me more" calls send with "Tell me more about <label>"', async () => {
    const { posts } = stubExplainFetch();
    const send = vi.fn();
    render(
      <Explain
        target={{ kind: 'step', id: 'write', context: 'wf-1' }}
        label="Write reply"
        onTellMeMore={send}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain Write reply' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));
    expect(send).toHaveBeenCalledWith('Tell me more about Write reply');
    expect(posts).toEqual([{ kind: 'step', id: 'write', context: 'wf-1' }]);
  });

  test('alt-click on a data-explain element opens the same popover at the pointer', async () => {
    const { posts } = stubExplainFetch();
    render(
      <>
        <div data-explain='{"kind":"ui","id":"turn-on","label":"Turn on"}'>Toggle me</div>
        <AltClickExplainRoot onTellMeMore={() => {}} />
      </>,
    );
    fireEvent.click(screen.getByText('Toggle me'), { altKey: true, clientX: 111, clientY: 222 });
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    const placed = screen.getByRole('dialog', { name: 'About Turn on' }).parentElement!;
    expect(placed.style.left).toBe('111px');
    expect(placed.style.top).toBe('222px');
    // The POST body is the bare wire target: label/x/y would 400 the strict server.
    expect(posts).toEqual([{ kind: 'ui', id: 'turn-on' }]);
  });

  test('clicking outside the popover closes it', async () => {
    stubExplainFetch();
    render(
      <Explain
        target={{ kind: 'step', id: 'write', context: 'wf-1' }}
        label="Write reply"
        onTellMeMore={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain Write reply' }));
    expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText(EXPLAIN_TEXT)).toBeNull();
  });

  test('without a send seam, "Tell me more" dispatches the window event WorkflowPage listens for', async () => {
    stubExplainFetch();
    const seen: unknown[] = [];
    const onEvent = (e: Event): void => {
      seen.push((e as CustomEvent).detail);
    };
    window.addEventListener('dad:tell-me-more', onEvent);
    try {
      render(<Explain target={{ kind: 'ui', id: 'turn-on' }} label="Turn on" />);
      fireEvent.click(screen.getByRole('button', { name: 'Explain Turn on' }));
      expect(await screen.findByText(EXPLAIN_TEXT)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }));
      expect(seen).toEqual([{ message: 'Tell me more about Turn on' }]);
    } finally {
      window.removeEventListener('dad:tell-me-more', onEvent);
    }
  });

  test('a plain click without alt opens nothing', () => {
    stubExplainFetch();
    render(
      <>
        <div data-explain='{"kind":"ui","id":"turn-on","label":"Turn on"}'>Toggle me</div>
        <AltClickExplainRoot onTellMeMore={() => {}} />
      </>,
    );
    fireEvent.click(screen.getByText('Toggle me'));
    expect(screen.queryByText(EXPLAIN_TEXT)).toBeNull();
  });
});
