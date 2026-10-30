import { SELECTORS } from './selectors.js';

export interface InboxEmail {
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
}

// Same long-hex shape readThreadId (lib/gmail/read.ts) accepts from
// location.hash: inbox rows without the thread attribute fall back to the
// token in a descendant link's #inbox/<thread> href.
const THREAD_IN_HREF = /([0-9a-f]{10,})/;

/**
 * Thread id for one inbox row: the row's data-legacy-thread-id first
 * (mirroring the open-thread anchor), else the hex token in a descendant
 * link href, else '' (the row is skipped — without an identity the server
 * cannot dedupe it).
 */
export function readRowThreadId(row: Element): string {
  const attr = row.getAttribute('data-legacy-thread-id');
  if (attr) return attr;
  for (const link of row.querySelectorAll('a[href]')) {
    const match = THREAD_IN_HREF.exec(link.getAttribute('href') ?? '');
    if (match?.[1]) return match[1];
  }
  return '';
}

/** Parse one unread row into the trigger payload, or null when unusable. */
export function parseInboxRow(row: Element): InboxEmail | null {
  const threadId = readRowThreadId(row);
  if (!threadId) return null;
  const sender = row.querySelector(SELECTORS.inboxSender);
  return {
    threadId,
    from: sender?.getAttribute('email') ?? '',
    fromName: sender?.textContent?.trim() ?? '',
    subject: row.querySelector(SELECTORS.inboxSubject)?.textContent?.trim() ?? '',
    snippet: row.querySelector(SELECTORS.inboxSnippet)?.textContent?.trim() ?? '',
  };
}

/**
 * Watch the inbox list for unread threads. Scans once immediately, then
 * observes (childList + subtree) for arrivals; each thread id emits ONCE per
 * page session (the Set survives Gmail's in-place re-renders), in document
 * order. Returns an unsubscribe that disconnects the observer.
 */
export function watchInbox(
  doc: Document,
  emit: (e: InboxEmail) => void,
): () => void {
  const seen = new Set<string>();

  const scan = (): void => {
    for (const row of doc.querySelectorAll(SELECTORS.inboxRow)) {
      const email = parseInboxRow(row);
      if (!email || seen.has(email.threadId)) continue;
      seen.add(email.threadId);
      emit(email);
    }
  };

  scan();

  const observer = new MutationObserver(() => scan());
  // Observe the stable main pane, NOT the list tbody: opening a thread and
  // returning replaces the tbody element, which would leave the observer on a
  // detached node (same root as gmail.content.ts).
  observer.observe(doc.querySelector(SELECTORS.mainRoot) ?? doc.body, {
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
