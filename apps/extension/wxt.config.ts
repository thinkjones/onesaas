import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OneSaaS',
    version: '0.1.0',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'identity'],
    // A run started by hand reads whatever page the owner is on, so any site can be
    // the source. Only read on their click; content scripts stay on the listed sites.
    host_permissions: ['<all_urls>'],
  },
});
