import { SELECTORS } from './selectors.js';
import { readThreadId } from './read.js';

export const WRONG_THREAD = "That email isn't open in Gmail.";
export const NO_REPLY_BOX = "I couldn't open the reply box.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open Reply on the open thread and fill the message body.
 *
 * expectedThreadId (optional, allowed addition to the plan signature) guards
 * against drafting into the wrong thread when the user navigated away between
 * the server's read and its draft call; a mismatch throws WRONG_THREAD.
 *
 * Fill strategy: document.execCommand('insertText') first (deprecated but
 * still working in Chrome, and it drives Gmail's composer state correctly),
 * falling back to textContent + a bubbling input event. The fallback is what
 * runs in jsdom, where execCommand doesn't exist.
 */
export async function draftReply(
  doc: Document,
  body: string,
  expectedThreadId?: string,
): Promise<{ drafted: true }> {
  if (expectedThreadId !== undefined && readThreadId(doc) !== expectedThreadId) {
    throw new Error(WRONG_THREAD);
  }

  const replyControl = doc.querySelector(
    `${SELECTORS.replyButton}, ${SELECTORS.replyFallback}`,
  ) as HTMLElement | null;
  if (!replyControl) throw new Error(NO_REPLY_BOX);
  replyControl.click();

  // The compose box mounts async after the click; poll briefly. Present
  // immediately in the fixture, so tests resolve on the first check.
  const deadline = Date.now() + 5000;
  let box: HTMLElement | null = null;
  while (Date.now() < deadline) {
    box = doc.querySelector(SELECTORS.messageBody) as HTMLElement | null;
    if (box) break;
    await sleep(100);
  }
  if (!box) throw new Error(NO_REPLY_BOX);

  box.focus();
  const withExec = doc as Document & {
    execCommand?: (command: string, ui: boolean, value: string) => boolean;
  };
  let inserted = false;
  if (typeof withExec.execCommand === 'function') {
    try {
      inserted = withExec.execCommand('insertText', false, body);
    } catch {
      inserted = false;
    }
  }
  if (!inserted) {
    box.textContent = body;
    const view = doc.defaultView;
    const InputCtor = view?.InputEvent ?? (typeof InputEvent !== 'undefined' ? InputEvent : null);
    box.dispatchEvent(
      InputCtor ? new InputCtor('input', { bubbles: true }) : new Event('input', { bubbles: true }),
    );
  }
  return { drafted: true };
}
