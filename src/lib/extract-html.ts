import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { ArticleExtraction } from './messages';

/**
 * Pull the readable article out of a document.
 *
 * Readability mutates the document it parses, so callers must hand in a clone —
 * the user's live page has to be left untouched.
 */
export function extractArticleFrom(doc: Document, fallbackTitle = ''): ArticleExtraction {
  const readerable = isProbablyReaderable(doc);
  let article: ReturnType<Readability['parse']> = null;

  try {
    article = new Readability(doc).parse();
  } catch {
    // Readability throws on some malformed documents; fall through to the body.
    article = null;
  }

  if (article?.content && article.textContent?.trim()) {
    return {
      title: (article.title || fallbackTitle || 'Untitled').trim(),
      html: article.content,
      text: article.textContent.trim(),
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      excerpt: article.excerpt ?? undefined,
    };
  }

  // Readability declines on non-article pages (tables, apps, search results).
  // Fall back to the body so the user still gets the visible content.
  const body = doc.body;
  return {
    title: (fallbackTitle || doc.title || 'Untitled').trim(),
    html: body?.innerHTML ?? '',
    text: (body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim(),
    excerpt: readerable ? undefined : 'Extracted from full page (no article detected).',
  };
}
