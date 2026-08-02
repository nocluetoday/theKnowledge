import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractArticleFrom } from '../src/lib/extract-html';
import { htmlToMarkdown } from '../src/lib/markdown';
import { buildClipNote } from '../src/lib/note-builder';

function parse(html: string): Document {
  return new JSDOM(html, { url: 'https://example.org/article' }).window.document;
}

/** A page shaped like a real clinical article, wrapped in site chrome. */
const ARTICLE_PAGE = `
<!doctype html>
<html><head><title>Management of Small Renal Masses | UroJournal</title></head>
<body>
  <nav><a href="/">Home</a><a href="/subscribe">Subscribe</a></nav>
  <aside class="ad">Advertisement: buy our stents</aside>
  <article>
    <h1>Management of Small Renal Masses</h1>
    <p>Small renal masses are renal tumors measuring four centimeters or less in
       greatest dimension. They account for a growing share of incidentally detected
       renal lesions, largely because cross-sectional imaging is used more often.</p>
    <h2>Treatment options</h2>
    <p>Partial nephrectomy remains the reference standard for the management of
       small renal masses, because it preserves functioning renal parenchyma while
       achieving oncologic control comparable to radical nephrectomy in this setting.</p>
    <ul><li>Partial nephrectomy</li><li>Thermal ablation</li><li>Active surveillance</li></ul>
    <p>Active surveillance is a reasonable option for older patients and for those
       with significant competing comorbidity, since the growth rate of most small
       renal masses is slow and the risk of metastasis during surveillance is low.</p>
  </article>
  <footer>Copyright 2026 UroJournal. All rights reserved.</footer>
</body></html>`;

describe('extractArticleFrom', () => {
  it('extracts the article and drops navigation, ads, and footer chrome', () => {
    const article = extractArticleFrom(parse(ARTICLE_PAGE));

    expect(article.text).toContain('Partial nephrectomy remains the reference standard');
    expect(article.text).toContain('Active surveillance');
    expect(article.text).not.toContain('buy our stents');
    expect(article.text).not.toContain('Subscribe');
    expect(article.text).not.toContain('All rights reserved');
  });

  it('uses the article title rather than the raw tab title', () => {
    expect(extractArticleFrom(parse(ARTICLE_PAGE)).title).toBe('Management of Small Renal Masses');
  });

  it('falls back to the body when the page is not an article', () => {
    const doc = parse('<html><head><title>Lab values</title></head><body><p>Creatinine 1.2</p></body></html>');

    const article = extractArticleFrom(doc, 'Lab values');

    expect(article.title).toBe('Lab values');
    expect(article.text).toContain('Creatinine 1.2');
  });

  it('does not throw on an empty document', () => {
    const article = extractArticleFrom(parse('<html><body></body></html>'), 'Blank');

    expect(article.title).toBe('Blank');
    expect(article.text).toBe('');
  });
});

describe('HTML clip path end to end', () => {
  it('produces a markdown note with headings, lists, and frontmatter', () => {
    const article = extractArticleFrom(parse(ARTICLE_PAGE));
    const markdown = htmlToMarkdown(article.html);
    const note = buildClipNote(
      {
        title: article.title,
        source: 'https://example.org/article',
        date: new Date(2026, 7, 1),
        type: 'clip',
      },
      markdown,
    );

    expect(note).toContain('type: clip');
    expect(note).toContain('source: "https://example.org/article"');
    expect(note).toContain('## Treatment options');
    expect(note).toContain('-   Thermal ablation');
    expect(note).toContain('Partial nephrectomy remains the reference standard');
    expect(note).not.toContain('<p>');
    expect(note).not.toContain('buy our stents');
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis, and links', () => {
    const markdown = htmlToMarkdown('<h2>Dosing</h2><p><em>Tamsulosin</em> <a href="https://x.test">0.4 mg</a></p>');

    expect(markdown).toContain('## Dosing');
    expect(markdown).toContain('*Tamsulosin*');
    expect(markdown).toContain('[0.4 mg](https://x.test)');
  });

  it('strips scripts and styles', () => {
    const markdown = htmlToMarkdown('<p>Keep</p><script>alert(1)</script><style>p{color:red}</style>');

    expect(markdown).toBe('Keep');
  });

  it('collapses runs of blank lines', () => {
    expect(htmlToMarkdown('<p>A</p><div></div><div></div><p>B</p>')).toBe('A\n\nB');
  });
});
