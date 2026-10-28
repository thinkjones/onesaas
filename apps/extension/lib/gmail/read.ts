import { SELECTORS } from './selectors.js';

export const NO_OPEN_EMAIL = "I can't see an open email. Open one in Gmail first.";

export interface OpenEmail {
  from: string;
  fromName: string;
  subject: string;
  body: string;
  threadId: string;
}

/**
 * Thread id of the open email: h2.hP[data-legacy-thread-id], else the long
 * hex-looking token in location.hash (Gmail thread urls end in it), else ''.
 * Shared by readOpenEmail, draftReply, and the content script so all three
 * agree on what "the open thread" is.
 */
export function readThreadId(doc: Document): string {
  const attr = doc.querySelector('h2.hP[data-legacy-thread-id]')?.getAttribute(
    'data-legacy-thread-id',
  );
  if (attr) return attr;
  const hashMatch = /([0-9a-f]{10,})/.exec(doc.location?.hash ?? '');
  return hashMatch?.[1] ?? '';
}

/**
 * Read the open Gmail thread. Body is the LAST div.a3s: cloned, .gmail_quote
 * blocks removed from the clone (original DOM untouched), then textContent
 * trimmed. textContent — not innerText — because jsdom has no layout engine
 * and innerText renders '' there; in real Chrome both agree on visible text.
 */
export function readOpenEmail(doc: Document): OpenEmail {
  const subject = doc.querySelector(SELECTORS.subject)?.textContent?.trim() ?? '';
  // A thread shows one sender chip per message; the LAST belongs to the
  // newest message, matching the LAST div.a3s body below.
  const senders = doc.querySelectorAll(SELECTORS.sender);
  const senderEl = senders[senders.length - 1] ?? null;
  const bodies = doc.querySelectorAll(SELECTORS.body);
  if (!subject || !senderEl || bodies.length === 0) throw new Error(NO_OPEN_EMAIL);

  const clone = bodies[bodies.length - 1]!.cloneNode(true) as Element;
  for (const quote of clone.querySelectorAll(SELECTORS.quotedHistory)) quote.remove();
  const body = clone.textContent?.trim() ?? '';

  return {
    from: senderEl.getAttribute('email') ?? '',
    fromName: senderEl.textContent?.trim() ?? '',
    subject,
    body,
    threadId: readThreadId(doc),
  };
}
