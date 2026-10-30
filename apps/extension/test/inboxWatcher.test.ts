// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { watchInbox } from '../lib/gmail/inboxWatcher.js';
import fixture from './fixtures/gmail-inbox.html?raw';

beforeEach(() => {
  document.body.innerHTML = fixture;
});

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

test('emits one event per unread row with the parsed email bits', () => {
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  try {
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, {
      threadId: 'inboxthread0001',
      from: 'jordan@example.com',
      fromName: 'Jordan Lee',
      subject: 'Booking for Saturday evening',
      snippet: 'Hi! Can I book a table for 4 this Saturday at 7pm? Thanks!',
    });
    // Row 2 has no thread attribute: the id falls back to the link token.
    expect(emit).toHaveBeenNthCalledWith(2, {
      threadId: '19c4d8e2f6a0b135',
      from: 'priya@example.com',
      fromName: 'Priya Nair',
      subject: 'Do you cater weekend events?',
      snippet: 'We loved your stall at the market. Do you cater small events?',
    });
  } finally {
    stop();
  }
});

test('re-rendering the same rows (tbody replaced) emits nothing new', async () => {
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  try {
    expect(emit).toHaveBeenCalledTimes(2);
    const tbody = document.querySelector('tbody')!;
    tbody.innerHTML = tbody.innerHTML; // Gmail re-renders list rows in place.
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

test('read rows (no zE) are never emitted', () => {
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  try {
    const subjects = emit.mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjects).not.toContain("This week's updates");
  } finally {
    stop();
  }
});

test('a newly arrived unread row emits exactly once', async () => {
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  try {
    expect(emit).toHaveBeenCalledTimes(2);
    document.querySelector('tbody')!.insertAdjacentHTML(
      'beforeend',
      `<tr class="zA zE" data-legacy-thread-id="inboxthread0009">
        <td class="yX"><span class="yP" email="sam@example.com">Sam Cove</span></td>
        <td class="y6"><span class="bog">Saturday pickup</span><span class="y2">Can I pick up at noon?</span></td>
      </tr>`,
    );
    await flush();
    await flush();
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenLastCalledWith({
      threadId: 'inboxthread0009',
      from: 'sam@example.com',
      fromName: 'Sam Cove',
      subject: 'Saturday pickup',
      snippet: 'Can I pick up at noon?',
    });
  } finally {
    stop();
  }
});

test('rows without any thread id are ignored', () => {
  document.body.innerHTML = `<div role="main"><table><tbody>
    <tr class="zA zE">
      <td class="yX"><span class="yP" email="ghost@example.com">Ghost</span></td>
      <td class="y6"><span class="bog">No identity</span><span class="y2">no thread anywhere</span></td>
    </tr>
  </tbody></table></div>`;
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  try {
    expect(emit).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test('the returned unsubscribe stops all further emission', async () => {
  const emit = vi.fn();
  const stop = watchInbox(document, emit);
  expect(emit).toHaveBeenCalledTimes(2);
  stop();
  document.querySelector('tbody')!.insertAdjacentHTML(
    'beforeend',
    `<tr class="zA zE" data-legacy-thread-id="inboxthread0010">
      <td class="yX"><span class="yP" email="late@example.com">Late</span></td>
      <td class="y6"><span class="bog">After stop</span><span class="y2">must not emit</span></td>
    </tr>`,
  );
  await flush();
  await flush();
  expect(emit).toHaveBeenCalledTimes(2);
});
