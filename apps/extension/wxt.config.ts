import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "My Dad's AI Agent",
    version: '0.1.0',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting'],
    host_permissions: [
      'https://mail.google.com/*',
      'https://calendar.google.com/*',
      'https://business.facebook.com/*',
      'http://127.0.0.1:8787/*',
    ],
  },
});
