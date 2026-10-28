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
        },
      },
      tabs: {
        query: (query) => browser.tabs.query(query),
        sendMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
      },
      runtime: {
        onMessage: {
          addListener: (fn) => {
            browser.runtime.onMessage.addListener(fn);
          },
        },
      },
    },
    WebSocket: WebSocket as unknown as WebSocketCtor,
  });
  void bg.boot();
});
