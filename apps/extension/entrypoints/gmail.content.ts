import type { RunStatus } from '@onesaas/shared';
import { SELECTORS } from '../lib/gmail/selectors.js';
import { watchInbox } from '../lib/gmail/inboxWatcher.js';
import { readOpenEmail, readThreadId } from '../lib/gmail/read.js';
import { draftReply, WRONG_THREAD } from '../lib/gmail/draftReply.js';
import { injectButtons, setButtonStatus, type WorkflowButtonItem } from '../lib/gmail/button.js';

// Gmail adapter glue. The DOM-touching functions (read/draft/buttons) are
// unit-tested against the fixture in test/gmail.test.ts; this wiring
// (runtime messages + MutationObserver) needs a live Gmail tab and is
// covered by Task 11's E2E instead.
export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  main() {
    let buttons: WorkflowButtonItem[] = [];
    let lastThreadId = '';
    // Set once a pushed `buttons` list is processed. The boot pull reply and
    // pushed updates travel independent channels with no ordering guarantee,
    // so a pull reply arriving after a push must be ignored (it is stale).
    let sawPush = false;

    const onButtonClick = (workflowId: string) => {
      let email;
      try {
        email = readOpenEmail(document);
      } catch {
        return; // Navigated away mid-click; nothing to trigger with.
      }
      void browser.runtime
        .sendMessage({ action: 'trigger', workflowId, email })
        .catch(() => {
          // Background unreachable (extension reloaded mid-click); drop.
        });
    };

    const refresh = () => {
      lastThreadId = readThreadId(document);
      injectButtons(document, buttons, onButtonClick);
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = (message ?? {}) as Record<string, unknown>;
      if (msg['type'] === 'buttons') {
        sawPush = true;
        const items = msg['items'];
        buttons = Array.isArray(items) ? (items as WorkflowButtonItem[]) : [];
        refresh();
        return undefined;
      }
      if (msg['type'] === 'cmd') {
        // Returned promise resolves tabs.sendMessage on the background side.
        return handleCmd(msg);
      }
      if (msg['type'] === 'runStatus') {
        // Guard wrong-thread pills: paint only when the run's thread is the
        // open one (the background fans out to every Gmail tab). The message
        // carries runId (see the server's gmailButton trigger), which turns
        // the pill into a link to that run's runtime view.
        if (msg['threadId'] === readThreadId(document)) {
          setButtonStatus(
            document,
            String(msg['workflowId']),
            msg['status'] as RunStatus,
            typeof msg['runId'] === 'string' ? msg['runId'] : undefined,
            (path) => void browser.runtime.sendMessage({ action: 'openApp', path }),
          );
        }
        return undefined;
      }
      return undefined;
    });

    // Action names mirror the server executors (apps/server/src/steps/trigger.ts):
    // bridge.call('gmail', 'readOpenEmail' | 'draftReply', ...).
    async function handleCmd(
      msg: Record<string, unknown>,
    ): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
      const input = (msg['input'] ?? {}) as Record<string, unknown>;
      const threadId = typeof input['threadId'] === 'string' ? input['threadId'] : undefined;
      if (threadId !== undefined && threadId !== readThreadId(document)) {
        return { ok: false, error: WRONG_THREAD };
      }
      try {
        if (msg['action'] === 'readOpenEmail') {
          return { ok: true, output: readOpenEmail(document) };
        }
        if (msg['action'] === 'draftReply') {
          return {
            ok: true,
            output: await draftReply(document, String(input['body'] ?? ''), threadId),
          };
        }
        return { ok: false, error: `Unknown Gmail action: ${String(msg['action'])}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }

    const observer = new MutationObserver((mutations) => {
      // Ignore our own DOM writes (button renders, pills) to avoid loops.
      const external = mutations.some((m) => {
        const el = m.target.nodeType === 1 ? (m.target as Element) : m.target.parentElement;
        return el === null || el.closest(SELECTORS.buttonsContainer) === null;
      });
      if (!external) return;
      // Re-inject when Gmail navigates between threads (toolbar remounts) or
      // the open thread changed; refresh() is idempotent otherwise.
      if (
        readThreadId(document) !== lastThreadId ||
        !document.querySelector(SELECTORS.buttonsContainer)
      ) {
        refresh();
      }
    });
    observer.observe(document.querySelector(SELECTORS.mainRoot) ?? document.body, {
      childList: true,
      subtree: true,
    });

    refresh();

    // Always-on email trigger: every new unread thread fans out server-side
    // (workflowId '*') to all ON trigger.email workflows. No-ops in thread
    // view (no list rows match there). Same drop-on-unreachable contract as
    // button clicks; the watcher emits once per page session, so a dropped
    // send waits for a reload. Accepted: list tabs re-render often, and a
    // retry queue is M5 scope.
    watchInbox(document, (email) => {
      void browser.runtime
        .sendMessage({ action: 'trigger', workflowId: '*', triggerType: 'email', email })
        .catch(() => {
          // Background unreachable (extension reloaded); drop like clicks do.
        });
    });

    // Late-tab pull: the server sends `buttons` only on hello, so a tab that
    // boots after that push (pair-then-open-Gmail, reload with socket up)
    // would keep `[]` forever. Ask the background for the cached list; if it
    // is unreachable the pushed path still covers us, so ignore failures.
    void browser.runtime
      .sendMessage({ action: 'getButtons' })
      .then((reply) => {
        if (sawPush) return; // A fresher-or-equal push already won; reply is stale.
        const r = (reply ?? {}) as Record<string, unknown>;
        if (r['type'] === 'buttons' && Array.isArray(r['items'])) {
          buttons = r['items'] as WorkflowButtonItem[];
          refresh();
        }
      })
      .catch(() => {});
  },
});
