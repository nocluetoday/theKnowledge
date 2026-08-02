import { buildDownloadPath, buildFilename } from '../src/lib/filename';
import { extractPdf } from '../src/lib/extract-pdf';
import { htmlToMarkdown } from '../src/lib/markdown';
import { buildClipNote, buildRawFallbackNote, buildSummaryNote, NoteMetadata } from '../src/lib/note-builder';
import { loadSettings } from '../src/lib/settings';
import { summarize } from '../src/lib/summarize';
import type { ArticleExtraction, ClipMode, PageInfo, RunUpdate } from '../src/lib/messages';

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'clipper') return;

    // Deliberately not aborted when the port disconnects: a Firefox popup closes
    // as soon as it loses focus, so cancelling on disconnect would kill a
    // minutes-long summary the moment the user clicked the page behind it. The
    // run finishes and saves; progress messages are dropped once nobody listens.
    const controller = new AbortController();

    port.onMessage.addListener(async (raw: unknown) => {
      const message = raw as { type?: string; mode: ClipMode; page: PageInfo };
      if (message?.type !== 'start') return;

      const send = (update: RunUpdate) => {
        try {
          port.postMessage(update);
        } catch {
          // Popup closed mid-run; the work still finishes and saves.
        }
      };

      try {
        const { filename, chosen } = await run(message.mode, message.page, controller.signal, (text) =>
          send({ type: 'progress', message: text }),
        );
        send({ type: 'done', filename, chosen });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof SaveCancelled) {
          send({ type: 'cancelled' });
          return;
        }
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });
  });
});

async function run(
  mode: ClipMode,
  page: PageInfo,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<{ filename: string; chosen: boolean }> {
  const settings = await loadSettings();

  onProgress(page.kind === 'pdf' ? 'Reading the PDF…' : 'Reading the page…');
  const source = page.kind === 'pdf' ? await readPdf(page, signal) : await readArticle(page);

  const meta: NoteMetadata = {
    title: source.title,
    source: page.url,
    date: new Date(),
    type: mode === 'clip' ? 'clip' : 'summary',
  };

  let note: string;
  if (mode === 'clip') {
    note = buildClipNote(meta, source.markdown);
  } else {
    const result = await summarize(source.text, settings, onProgress, signal);
    meta.provider = settings.provider;
    meta.model = settings.providers[settings.provider].model;
    meta.chunks = result.chunks;
    note = result.raw
      ? buildRawFallbackNote(meta, result.raw)
      : buildSummaryNote(meta, result.sections);
  }

  onProgress(settings.askWhereToSave ? 'Choose where to save…' : 'Saving…');
  const filename = await save(note, meta, settings.subfolder, settings.askWhereToSave);
  return { filename, chosen: settings.askWhereToSave };
}

/** Thrown when the user dismisses the Save As dialog — expected, not a failure. */
export class SaveCancelled extends Error {
  constructor() {
    super('Save cancelled.');
    this.name = 'SaveCancelled';
  }
}

interface SourceContent {
  title: string;
  /** Markdown body used for clip mode. */
  markdown: string;
  /** Plain text sent to the model for summarize mode. */
  text: string;
}

async function readArticle(page: PageInfo): Promise<SourceContent> {
  await browser.scripting.executeScript({
    target: { tabId: page.tabId },
    files: ['content-scripts/content.js'],
  });

  const article = (await browser.tabs.sendMessage(page.tabId, {
    type: 'extract-article',
  })) as ArticleExtraction | undefined;

  if (!article || !article.text.trim()) {
    throw new Error('No readable content found on this page.');
  }

  return {
    title: article.title || page.title || 'Untitled',
    markdown: htmlToMarkdown(article.html),
    text: article.text,
  };
}

async function readPdf(page: PageInfo, signal: AbortSignal): Promise<SourceContent> {
  const pdf = await extractPdf(page.url, signal);
  if (!pdf.text.trim()) {
    throw new Error(
      'No text could be extracted — this PDF is probably a scan. It would need OCR first.',
    );
  }
  return {
    title: pdf.title || stripPdfExtension(page.title) || 'Untitled PDF',
    markdown: pdf.text,
    text: pdf.text,
  };
}

function stripPdfExtension(title: string): string {
  return title.replace(/\.pdf$/i, '').trim();
}

async function save(
  note: string,
  meta: NoteMetadata,
  subfolder: string,
  askWhereToSave: boolean,
): Promise<string> {
  const filename = buildFilename(meta.title, meta.date);
  // Always Downloads-relative: absolute paths are rejected outright. With
  // `saveAs`, this only pre-fills the dialog — the user can then save anywhere.
  const path = buildDownloadPath(subfolder, filename);

  // Firefox's downloads API accepts blob: URLs from the background context.
  const blob = new Blob([note], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url,
      filename: path,
      conflictAction: 'uniquify',
      saveAs: askWhereToSave,
    });
  } catch (error) {
    if (askWhereToSave && isUserCancellation(error)) throw new SaveCancelled();
    throw error;
  } finally {
    // Revoking immediately can cancel an in-flight download; give it a moment.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return askWhereToSave ? filename : path;
}

/** Firefox reports a dismissed Save As dialog as a generic download error. */
function isUserCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancell?ed|aborted/i.test(message);
}
