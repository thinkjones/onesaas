import { isOnDayPage, readDayEvents } from '../lib/calendar/freeBusy.js';
import { createEventUrl, saveTemplateEvent } from '../lib/calendar/createEvent.js';

// Calendar adapter glue. The DOM-touching functions (read/save) and the URL
// builder are unit-tested against the fixture in test/calendar.test.ts; this
// wiring needs a live Calendar tab and is covered by E2E instead.

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
  matches: ['https://calendar.google.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = (message ?? {}) as Record<string, unknown>;
      if (msg['type'] === 'cmd') {
        // Returned promise resolves tabs.sendMessage on the background side.
        return handleCmd(msg);
      }
      return undefined;
    });

    // Action names mirror the server executors (apps/server/src/steps/calendar.ts):
    // bridge.call('calendar', 'readDay' | 'createEvent', ...).
    async function handleCmd(
      msg: Record<string, unknown>,
    ): Promise<{ ok: true; output: unknown } | { ok: false; error: string; code?: string }> {
      const input = (msg['input'] ?? {}) as Record<string, unknown>;
      try {
        if (msg['action'] === 'readDay') {
          const url = typeof input['url'] === 'string' ? input['url'] : undefined;
          if (url !== undefined && !isOnDayPage(document.location.href, url)) {
            navigateSoon(url);
            return { ok: true, output: { navigated: true } };
          }
          return { ok: true, output: { events: readDayEvents(document) } };
        }
        if (msg['action'] === 'createEvent') {
          if (input['navigate'] === true) {
            // Pre-Task-3 the browser zone is the business zone (server and
            // Chrome run on the same machine); UTC only when none resolves.
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
            navigateSoon(
              createEventUrl({
                title: String(input['title'] ?? ''),
                start: String(input['start'] ?? ''),
                end: String(input['end'] ?? ''),
                ...(typeof input['details'] === 'string' ? { details: input['details'] } : {}),
                timezone,
              }),
            );
            return { ok: true, output: { navigated: true } };
          }
          await saveTemplateEvent(document);
          return { ok: true, output: { saved: true } };
        }
        return { ok: false, error: `Unknown Calendar action: ${String(msg['action'])}` };
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
