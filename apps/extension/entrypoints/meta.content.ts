import { COMPOSER_URL, isOnComposerPage, prepareDraftPost } from '../lib/meta/draftPost.js';

// Meta adapter glue. The DOM-touching prepare function is unit-tested
// against the fixture in test/meta.test.ts; this wiring needs a live
// Business Suite tab and is covered by E2E instead.

// Same postable set as lib/background.ts: the server's protocol parser
// rejects anything else, so unknown codes are dropped, never forwarded.
const VALID_CODES = ['SELECTOR_MISSING', 'NOT_OPEN', 'TIMEOUT', 'HANDOFF'];

function errCode(code: unknown): string | undefined {
  return typeof code === 'string' && VALID_CODES.includes(code) ? code : undefined;
}

// Navigate on a short delay so this turn's reply flushes BEFORE the unload:
// a synchronous location change can cancel the sendMessage reply and the
// server would read a TIMEOUT instead of { navigated: true }.
function navigateSoon(url: string): void {
  setTimeout(() => {
    document.location.href = url;
  }, 50);
}

export default defineContentScript({
  matches: ['https://business.facebook.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = (message ?? {}) as Record<string, unknown>;
      if (msg['type'] === 'cmd') {
        // Returned promise resolves tabs.sendMessage on the background side.
        return handleCmd(msg);
      }
      return undefined;
    });

    // Action names mirror the server executor (apps/server/src/steps/meta.ts):
    // bridge.call('meta', 'draftPost', ...).
    async function handleCmd(
      msg: Record<string, unknown>,
    ): Promise<{ ok: true; output: unknown } | { ok: false; error: string; code?: string }> {
      const input = (msg['input'] ?? {}) as Record<string, unknown>;
      try {
        if (msg['action'] === 'draftPost') {
          // The background focuses ANY Business Suite tab (or the start
          // page); only the composer page can be filled, so navigate there
          // first and let the server retry once it settles.
          if (!isOnComposerPage(document.location.href)) {
            navigateSoon(COMPOSER_URL);
            return { ok: true, output: { navigated: true } };
          }
          const text = typeof input['text'] === 'string' ? input['text'] : '';
          const imageDataUrl =
            typeof input['imageDataUrl'] === 'string' ? input['imageDataUrl'] : undefined;
          const output = await prepareDraftPost(
            document,
            imageDataUrl === undefined ? { text } : { text, imageDataUrl },
          );
          return { ok: true, output };
        }
        return { ok: false, error: `Unknown Meta action: ${String(msg['action'])}` };
      } catch (e) {
        const err = e as Error & { code?: unknown };
        const code = errCode(err.code);
        return code === undefined
          ? { ok: false, error: err.message }
          : { ok: false, error: err.message, code };
      }
    }
  },
});
