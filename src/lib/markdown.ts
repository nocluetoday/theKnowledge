import TurndownService from 'turndown';

/**
 * Turndown configured for article prose: ATX headings, fenced code, and
 * `-` bullets so the output reads well in Obsidian.
 */
function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  service.remove(['script', 'style', 'noscript', 'iframe', 'form']);

  // Readability leaves figure captions inline; render them as italic lines.
  service.addRule('figcaption', {
    filter: 'figcaption',
    replacement: (content) => (content.trim() ? `\n\n*${content.trim()}*\n\n` : ''),
  });

  return service;
}

let cached: TurndownService | undefined;

export function htmlToMarkdown(html: string): string {
  cached ??= createTurndown();
  return cached
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
