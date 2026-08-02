import * as pdfjs from 'pdfjs-dist';

// pdf.js ships its own ES-module worker; `scripts/copy-pdf-worker.mjs` places it
// in `public/` so it is served unmodified from the extension root. Routing it
// through Vite's worker pipeline instead produces a worker that throws on load.
pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('/pdf.worker.mjs');

export interface PdfExtraction {
  /** Plain text with `## Page N` markers, used as both clip body and LLM input. */
  text: string;
  pageCount: number;
  /** Title from the PDF metadata, when present. */
  title?: string;
}

/**
 * Fetch a PDF and extract its text with the bundled pdf.js.
 *
 * The background script re-fetches the bytes rather than scraping the viewer:
 * Firefox's built-in PDF viewer runs in a privileged context a content script
 * cannot reach into.
 */
export async function extractPdf(url: string, signal?: AbortSignal): Promise<PdfExtraction> {
  const response = await fetch(url, { signal, credentials: 'include' });
  if (!response.ok) {
    throw new Error(
      `Could not download the PDF (HTTP ${response.status}). If it needs a login, save it locally and open the file instead.`,
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = joinTextItems(content.items as TextItemLike[]);
    pages.push(`## Page ${pageNumber}\n\n${pageText}`);
    page.cleanup();
  }

  let title: string | undefined;
  try {
    const metadata = await doc.getMetadata();
    const raw = (metadata.info as { Title?: string } | undefined)?.Title;
    if (raw && raw.trim()) title = raw.trim();
  } catch {
    // Metadata is optional; a missing title just falls back to the tab title.
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  return { text: pages.join('\n\n').trim(), pageCount, title };
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/**
 * pdf.js emits one item per text run. Join runs on the same line with spaces
 * and break where the item reports an end-of-line.
 */
function joinTextItems(items: TextItemLike[]): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
