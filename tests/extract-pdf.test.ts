import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PAGE_MARKER, chunkText } from '../src/lib/chunking';

/**
 * `extract-pdf.ts` sets `workerSrc` from `browser.runtime.getURL` at import
 * time, so the extension API has to exist before the module is loaded. Under
 * Node, pdf.js loads that path as a real module — so resolve it to the same
 * pdf.js worker the extension ships, exercising the genuine worker code.
 */
const WORKER_URL = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

vi.stubGlobal('browser', { runtime: { getURL: () => WORKER_URL } });

const PDF_PATH = new URL('./fixtures/sample.pdf', import.meta.url);

let extractPdf: typeof import('../src/lib/extract-pdf').extractPdf;

beforeAll(async () => {
  ({ extractPdf } = await import('../src/lib/extract-pdf'));
});

afterEach(() => vi.unstubAllGlobals);

/** Serve the fixture bytes through a stubbed fetch, as the background script would. */
function stubPdfFetch(): void {
  const bytes = readFileSync(PDF_PATH);
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }));
}

describe('extractPdf', () => {
  it('extracts text from a real PDF with page markers', async () => {
    stubPdfFetch();

    const result = await extractPdf('https://example.org/sample.pdf');

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.text).toContain('## Page 1');
    expect(result.text).toContain('Renal cell carcinoma');
    expect(result.text).toContain('T1a');
  });

  it('produces page markers that the chunker splits on', async () => {
    stubPdfFetch();

    const { text } = await extractPdf('https://example.org/sample.pdf');
    const firstLine = text.split('\n')[0];

    expect(PAGE_MARKER.test(firstLine)).toBe(true);
    // The extracted text round-trips through chunking without loss.
    expect(chunkText(text, { chunkSize: 100_000 })).toEqual([text.trim()]);
  });

  it('explains an HTTP failure rather than surfacing a raw status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403 }));

    await expect(extractPdf('https://example.org/private.pdf')).rejects.toThrow(
      /Could not download the PDF \(HTTP 403\).*save it locally/s,
    );
  });
});
