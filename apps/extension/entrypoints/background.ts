import { createBackground, type WebSocketCtor } from '../lib/background.js';

// Thin WXT adapter: the real promise-style `browser` namespace (NOT
// callback-style chrome.*) and the DOM WebSocket onto the injectable seams
// in lib/background.ts. All socket/pairing/relay logic lives there and is
// covered by test/background.test.ts; this file is intentionally untested.
export default defineBackground(() => {
  const bg = createBackground({
    browser: {
      storage: {
        local: {
          get: (key) => browser.storage.local.get(key),
          set: (items) => browser.storage.local.set(items),
          remove: (key) => browser.storage.local.remove(key),
        },
      },
      tabs: {
        query: (query) => browser.tabs.query(query),
        get: (tabId) => browser.tabs.get(tabId),
        create: (props) => browser.tabs.create(props),
        update: (tabId, props) => browser.tabs.update(tabId, props),
        captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId),
        sendMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
      },
      runtime: {
        onMessage: {
          addListener: (fn) => {
            browser.runtime.onMessage.addListener(fn);
          },
        },
      },
      identity: {
        getProfileUserInfo: () => browser.identity.getProfileUserInfo(),
      },
    },
    WebSocket: WebSocket as unknown as WebSocketCtor,
  });
  void bg.boot();
  // The toolbar button opens the side panel (the popup is gone). Chrome-only
  // API — Firefox serves the same page as sidebar_action and skips this.
  const setBehavior = (
    browser as unknown as {
      sidePanel?: { setPanelBehavior?: (behavior: { openPanelOnActionClick: boolean }) => unknown };
    }
  ).sidePanel?.setPanelBehavior;
  if (typeof setBehavior === 'function') {
    void Promise.resolve()
      .then(() => setBehavior({ openPanelOnActionClick: true }))
      .catch(() => {});
  }
});
