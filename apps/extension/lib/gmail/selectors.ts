// ALL Gmail DOM selectors and data-onesaas-* hook names live here. Nothing outside
// this file may hardcode a Gmail selector, so a Gmail markup change is a
// one-file fix. Starting points verified against
// test/fixtures/gmail-thread.html (SYNTHETIC — see its header).

export const SELECTORS = {
  /** Thread subject line; also carries data-legacy-thread-id. */
  subject: 'h2.hP',
  /** Sender chip: text is the name, `email` attr is the address. */
  sender: 'span.gD',
  /** Rendered message bodies; the LAST one in the thread is the newest. */
  body: 'div.a3s',
  /** Quoted history inside a body; stripped from the clone before reading. */
  quotedHistory: 'div.gmail_quote',
  /** Reply control (primary). */
  replyButton: '[role="button"][data-tooltip^="Reply"]',
  /** Reply control (older/alternate markup fallback). */
  replyFallback: 'span.ams.bkH',
  /** Compose/reply message body. */
  messageBody: 'div[aria-label="Message Body"]',
  /** Message header actions container (toolbar anchor). */
  toolbar: '[role="toolbar"]',
  /**
   * Fixture/test-only toolbar hook. Real Gmail toolbars resolve via
   * [role=toolbar]; this exists so tests can anchor an injection container
   * without faking a full role=toolbar. Never relied on in production.
   */
  toolbarTestHook: '[data-onesaas-toolbar]',
  /** Our own injected button container (also the MutationObserver skip-marker). */
  buttonsContainer: 'div.onesaas-gmail-buttons',
  /** Status pill inside one of our buttons. */
  statusPill: '.onesaas-status-pill',
  /** Gmail main pane; MutationObserver root (falls back to body). */
  mainRoot: 'div[role="main"]',
  /** Unread inbox rows (read rows are tr.zA WITHOUT zE). */
  inboxRow: 'tr.zA.zE',
  /** Inbox list container (the watcher observes mainRoot, which survives list re-renders). */
  inboxList: 'div[role="main"] table tbody',
  /** Sender chip inside a list row: text is the name, `email` attr the address. */
  inboxSender: 'span.yP',
  /** Subject line inside a list row. */
  inboxSubject: 'span.bog',
  /** Snippet (preview text) inside a list row. */
  inboxSnippet: 'span.y2',
} as const;

/**
 * Resolve the message toolbar to inject buttons into: the toolbar nearest the
 * reply control first (right thread in split views), else the first toolbar in
 * the document, else the test-only hook. Null in thread list view (no-op).
 */
export function resolveToolbar(doc: Document): Element | null {
  const replyControl = doc.querySelector(`${SELECTORS.replyButton}, ${SELECTORS.replyFallback}`);
  return (
    replyControl?.closest(SELECTORS.toolbar) ??
    doc.querySelector(SELECTORS.toolbar) ??
    doc.querySelector(SELECTORS.toolbarTestHook)
  );
}
