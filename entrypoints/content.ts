import { extractArticleFrom } from '../src/lib/extract-html';
import type { ExtractArticleRequest } from '../src/lib/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Injected on demand by the background script, not on every page load.
  registration: 'runtime',

  main() {
    browser.runtime.onMessage.addListener((raw: unknown) => {
      const message = raw as ExtractArticleRequest | undefined;
      if (message?.type !== 'extract-article') return;

      // Readability mutates the document it parses — give it a clone.
      const clone = document.cloneNode(true) as Document;
      return Promise.resolve(extractArticleFrom(clone, document.title));
    });
  },
});
