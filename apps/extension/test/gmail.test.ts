// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { gmailThreadUrl, readOpenEmail } from '../lib/gmail/read.js';
import { draftReply } from '../lib/gmail/draftReply.js';
import { injectButtons, setButtonStatus } from '../lib/gmail/button.js';
import { SELECTORS } from '../lib/gmail/selectors.js';
import fixture from './fixtures/gmail-thread.html?raw';

beforeEach(() => {
  document.body.innerHTML = fixture;
  window.location.hash = '';
});

describe('readOpenEmail', () => {
  it('returns subject, sender, body without quoted history, and threadId', () => {
    const email = readOpenEmail(document);
    expect(email.subject).toBe('Catering quote for Saturday');
    expect(email.from).toBe('sarah@example.com');
    expect(email.fromName).toBe('Sarah Lee');
    expect(email.threadId).toBe('fixturethread0001');
    expect(email.body).toBe(
      'Hi! For 40 people this Saturday we can do $18 per head, delivery included.\n        Let me know if you want to go ahead and I will lock it in.',
    );
    expect(email.body).not.toContain('On Tue, Oct 27');
  });

  it('throws the exact no-open-email error when nothing is open', () => {
    document.body.innerHTML = '<div role="main"></div>';
    expect(() => readOpenEmail(document)).toThrow(
      "I can't see an open email. Open one in Gmail first.",
    );
  });

  it('falls back to the thread id in location.hash when the attribute is missing', () => {
    document.querySelector('h2.hP')!.removeAttribute('data-legacy-thread-id');
    window.location.hash = '#inbox/18f3a9c2d4e5b607';
    expect(readOpenEmail(document).threadId).toBe('18f3a9c2d4e5b607');
  });
});

describe('gmailThreadUrl', () => {
  it('builds the all-mail thread URL the worker tab navigates to', () => {
    expect(gmailThreadUrl('thread_abc123')).toBe(
      'https://mail.google.com/mail/u/0/#all/thread_abc123',
    );
  });
});

describe('injectButtons', () => {
  it('adds exactly one button with the workflow label', () => {
    injectButtons(
      document,
      [{ workflowId: 'wf_lead', label: '✨ Save as lead & reply' }],
      () => {},
    );
    const buttons = document.querySelectorAll('div.onesaas-gmail-buttons button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('✨ Save as lead & reply');
  });

  it('is idempotent: calling twice still leaves one button', () => {
    const onClick = vi.fn();
    const items = [{ workflowId: 'wf_lead', label: '✨ Save as lead & reply' }];
    injectButtons(document, items, onClick);
    injectButtons(document, items, onClick);
    expect(document.querySelectorAll('div.onesaas-gmail-buttons button')).toHaveLength(1);
  });

  it('routes clicks to onClick with the workflow id', () => {
    const onClick = vi.fn();
    injectButtons(document, [{ workflowId: 'wf_lead', label: '✨ Save as lead & reply' }], onClick);
    (document.querySelector('div.onesaas-gmail-buttons button') as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledWith('wf_lead');
  });

  it('no-ops when there is no toolbar (e.g. thread list view)', () => {
    document.body.innerHTML = '<div role="main"><h2>list view</h2></div>';
    expect(() =>
      injectButtons(document, [{ workflowId: 'w', label: 'x' }], () => {}),
    ).not.toThrow();
    expect(document.querySelector('div.onesaas-gmail-buttons')).toBeNull();
  });
});

describe('setButtonStatus', () => {
  beforeEach(() => {
    injectButtons(document, [{ workflowId: 'wf_lead', label: '✨ Save as lead & reply' }], () => {});
  });

  it.each([
    ['running', 'Working…'],
    ['waiting', 'Waiting for you'],
    ['done', '✓ Done'],
    ['failed', 'Needs a look'],
  ] as const)('%s shows the %s pill', (status, pill) => {
    setButtonStatus(document, 'wf_lead', status);
    const button = document.querySelector('button[data-workflow-id="wf_lead"]')!;
    expect(button.getAttribute('data-status')).toBe(status);
    expect(button.querySelector('.onesaas-status-pill')!.textContent).toBe(pill);
  });

  it('no-ops for an unknown workflow id', () => {
    expect(() => setButtonStatus(document, 'nope', 'running')).not.toThrow();
  });

  it('waiting with a run id renders a pill link to the runtime view', () => {
    setButtonStatus(document, 'wf_lead', 'waiting', 'run-1');
    const pill = document.querySelector('button[data-workflow-id="wf_lead"] .onesaas-status-pill')!;
    expect(pill.textContent).toBe('Waiting for you');
    expect(pill.tagName).toBe('A');
    expect(pill.getAttribute('href')).toBe(
      'http://localhost:5173/automations/wf_lead?mode=runs&run=run-1',
    );
  });

  it('clicking the pill asks to open the run in the app, without firing the button', () => {
    const open = vi.fn();
    setButtonStatus(document, 'wf_lead', 'waiting', 'run-1', open);
    const pill = document.querySelector<HTMLElement>('button[data-workflow-id="wf_lead"] .onesaas-status-pill')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    pill.dispatchEvent(click);
    expect(open).toHaveBeenCalledWith('/automations/wf_lead?mode=runs&run=run-1');
    expect(click.defaultPrevented).toBe(true);
  });

  it('without a run id the pill is plain text, not a link', () => {
    setButtonStatus(document, 'wf_lead', 'waiting');
    const pill = document.querySelector('button[data-workflow-id="wf_lead"] .onesaas-status-pill')!;
    expect(pill.tagName).toBe('SPAN');
    expect(pill.getAttribute('href')).toBeNull();
  });

  it('clicking the pill link does not re-trigger the workflow', () => {
    const onClick = vi.fn();
    injectButtons(document, [{ workflowId: 'wf_lead', label: '✨ Save as lead & reply' }], onClick);
    setButtonStatus(document, 'wf_lead', 'waiting', 'run-1');
    (document.querySelector('.onesaas-status-pill') as HTMLElement).click();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('draftReply', () => {
  it('fills the reply box with the given text', async () => {
    const replyControl = document.querySelector(
      `${SELECTORS.replyButton}, ${SELECTORS.replyFallback}`,
    ) as HTMLElement;
    const clickSpy = vi.spyOn(replyControl, 'click');
    const out = await draftReply(document, 'Thanks Sarah — please lock it in!');
    expect(clickSpy).toHaveBeenCalled();
    expect(out).toEqual({ drafted: true });
    expect(document.querySelector('div[aria-label="Message Body"]')!.textContent).toBe(
      'Thanks Sarah — please lock it in!',
    );
  });

  it('throws when the expected thread is not the open one', async () => {
    await expect(draftReply(document, 'hi', 'some-other-thread')).rejects.toThrow(
      "That email isn't open in Gmail.",
    );
  });

  it('throws when the reply control is missing', async () => {
    document.querySelector('[role="button"][data-tooltip="Reply"]')!.remove();
    await expect(draftReply(document, 'hi')).rejects.toThrow("I couldn't open the reply box.");
  });
});
