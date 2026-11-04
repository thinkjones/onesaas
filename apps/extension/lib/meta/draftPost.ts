import { TabError } from '../tabs.js';
import { SELECTORS } from './selectors.js';

/** The new-post composer. The content script navigates here when off-page. */
export const COMPOSER_URL = 'https://business.facebook.com/latest/composer';

/** Overlay text (exact string, pinned by tests + the M4 plan). */
export const PASTE_HINT =
  "Your photo is copied. Click here and press ⌘V, then Publish when you're happy.";

/** True when the tab already shows the composer (query params allowed). */
export function isOnComposerPage(href: string): boolean {
  return href.startsWith(COMPOSER_URL);
}

// The server's dataUrl() returns the STORED mime (image/jpeg for every
// non-PNG upload), so the Blob type and the ClipboardItem key both come off
// the data URL itself — a hardcoded image/png would mislabel JPEG bytes and
// Chrome would reject the write or paste garbage. Bare base64 with no
// header keeps the old default.
function dataUrlMime(dataUrl: string): string {
  return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes.buffer], { type: dataUrlMime(dataUrl) });
}

function fillComposer(box: HTMLElement, doc: Document, text: string): void {
  box.focus();
  // Same fill strategy as the Gmail draftReply (deprecated execCommand drives
  // the host app's composer state correctly in Chrome; the fallback is what
  // runs in jsdom, where execCommand doesn't exist).
  const withExec = doc as Document & {
    execCommand?: (command: string, ui: boolean, value: string) => boolean;
  };
  let inserted = false;
  if (typeof withExec.execCommand === 'function') {
    try {
      inserted = withExec.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
  }
  if (!inserted) {
    box.textContent = text;
    const view = doc.defaultView;
    const InputCtor = view?.InputEvent ?? (typeof InputEvent !== 'undefined' ? InputEvent : null);
    box.dispatchEvent(
      InputCtor ? new InputCtor('input', { bubbles: true }) : new Event('input', { bubbles: true }),
    );
  }
}

function showPasteHint(doc: Document): void {
  // Idempotent: a second prepare replaces the hint, never stacks another.
  doc.querySelector('[data-onesaas-meta-hint]')?.remove();
  const hint = doc.createElement('div');
  hint.setAttribute('data-onesaas-meta-hint', '');
  hint.setAttribute('role', 'status');
  hint.textContent = PASTE_HINT;
  // Adjacent to (never covering) the media area, with pointer events off so
  // The owner's click lands on the attachment control itself.
  hint.style.position = 'fixed';
  hint.style.zIndex = '2147483647';
  hint.style.pointerEvents = 'none';
  hint.style.background = '#1c1e21';
  hint.style.color = '#fff';
  hint.style.padding = '8px 12px';
  hint.style.borderRadius = '8px';
  hint.style.fontSize = '14px';
  hint.style.maxWidth = '320px';
  const media = doc.querySelector(SELECTORS.mediaArea);
  if (media) {
    const rect = media.getBoundingClientRect();
    hint.style.left = `${Math.max(rect.left, 8)}px`;
    hint.style.top = `${Math.max(rect.top - 56, 8)}px`;
  } else {
    hint.style.left = '8px';
    hint.style.top = '8px';
  }
  doc.body.appendChild(hint);
}

/**
 * Fill the Business Suite composer with `text`, copy the photo to the
 * clipboard under its own mime type (the host page has no
 * automation-safe upload), and point a hint at the media area telling the owner
 * to paste and press Publish.
 * Reliability-ladder position: selectors, then hand off to the owner (no Send,
 * Publish or Post click — the global M4 constraint).
 */
export async function prepareDraftPost(
  doc: Document,
  o: { text: string; imageDataUrl?: string },
): Promise<{ textFilled: boolean; imageCopied: boolean }> {
  const box = doc.querySelector(SELECTORS.composer) as HTMLElement | null;
  if (!box) throw new TabError('SELECTOR_MISSING', "I couldn't find the post composer.");
  fillComposer(box, doc, o.text);
  if (o.imageDataUrl === undefined) return { textFilled: true, imageCopied: false };
  // A failed copy must fail LOUD: pasting with a stale clipboard would
  // attach the wrong photo, which looks like success.
  try {
    const clipboard = doc.defaultView?.navigator.clipboard;
    if (!clipboard) throw new Error('no clipboard');
    const mime = dataUrlMime(o.imageDataUrl);
    await clipboard.write([new ClipboardItem({ [mime]: dataUrlToBlob(o.imageDataUrl) })]);
  } catch {
    throw new Error("I couldn't copy the photo to the clipboard.");
  }
  showPasteHint(doc);
  return { textFilled: true, imageCopied: true };
}
