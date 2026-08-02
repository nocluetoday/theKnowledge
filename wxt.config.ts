import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Medical Knowledge Clipper',
    description:
      'Clip or AI-summarize medical knowledge from the current page (HTML or PDF) into a markdown note saved under Downloads.',
    permissions: ['activeTab', 'scripting', 'downloads', 'storage'],
    host_permissions: ['<all_urls>'],
    browser_specific_settings: {
      gecko: {
        id: 'med-knowledge-clipper@donneff.dev',
      },
    },
  },
});
