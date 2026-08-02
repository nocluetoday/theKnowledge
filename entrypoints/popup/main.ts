import type { ClipMode, PageInfo, RunUpdate } from '../../src/lib/messages';

const titleEl = document.getElementById('page-title') as HTMLHeadingElement;
const kindEl = document.getElementById('page-kind') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const previewEl = document.getElementById('preview') as HTMLPreElement;
const clipButton = document.getElementById('clip') as HTMLButtonElement;
const summarizeButton = document.getElementById('summarize') as HTMLButtonElement;
const cancelButton = document.getElementById('cancel') as HTMLButtonElement;
const settingsButton = document.getElementById('settings') as HTMLButtonElement;

/** How long to wait on the content-type sniff before assuming HTML. */
const SNIFF_TIMEOUT_MS = 1500;

let page: PageInfo | undefined;
/** Resolves once the PDF sniff settles; awaited only if the user clicks first. */
let kindReady: Promise<void> = Promise.resolve();
/** The port for the run in progress, so Cancel can reach the background. */
let activePort: ReturnType<typeof browser.runtime.connect> | undefined;

settingsButton.addEventListener('click', () => browser.runtime.openOptionsPage());
clipButton.addEventListener('click', () => void start('clip'));
summarizeButton.addEventListener('click', () => void start('summarize'));
cancelButton.addEventListener('click', () => {
  activePort?.postMessage({ type: 'cancel' });
  setStatus('Cancelling…');
});

void init();

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url || !/^(https?|file):/.test(tab.url)) {
    titleEl.textContent = 'Unsupported page';
    setStatus('Open a web page or PDF to clip it.', 'error');
    return;
  }

  const url = tab.url;
  page = { tabId: tab.id, url, title: tab.title ?? 'Untitled', kind: 'html' };
  titleEl.textContent = page.title;

  // The buttons work immediately. Detecting a PDF can need a network round trip,
  // and making the user wait on it before their first click was the single
  // longest delay in the popup.
  clipButton.disabled = false;
  summarizeButton.disabled = false;

  if (/\.pdf(?:[?#]|$)/i.test(url)) {
    setKind('pdf');
    return;
  }

  kindEl.textContent = 'Web page';
  kindReady = sniffPdf(url).then((isPdf) => {
    if (isPdf) setKind('pdf');
  });
}

function setKind(kind: PageInfo['kind']): void {
  if (page) page.kind = kind;
  kindEl.textContent = kind === 'pdf' ? 'PDF document' : 'Web page';
}

/** Check the content type without letting a slow origin hold up the popup. */
async function sniffPdf(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      // Same credentials the real PDF fetch uses, so a cookie-authenticated
      // PDF is not misdetected as an HTML page.
      credentials: 'include',
      signal: AbortSignal.timeout(SNIFF_TIMEOUT_MS),
    });
    return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf');
  } catch {
    // Timed out, blocked, or offline — treat it as an ordinary page.
    return false;
  }
}

async function start(mode: ClipMode): Promise<void> {
  if (!page) return;

  setBusy(true);
  setStatus(mode === 'clip' ? 'Clipping…' : 'Starting…');
  showPreview('');

  // If the sniff has not settled yet, it is nearly done — wait for it now so the
  // right extractor runs.
  await kindReady;

  const port = browser.runtime.connect({ name: 'clipper' });
  activePort = port;
  let finished = false;

  const finish = () => {
    finished = true;
    setBusy(false);
    activePort = undefined;
    port.disconnect();
  };

  port.onMessage.addListener((raw: unknown) => {
    const update = raw as RunUpdate;
    if (update.type === 'progress') {
      setStatus(update.message);
    } else if (update.type === 'partial') {
      showPreview(update.text);
    } else if (update.type === 'done') {
      // With the Save As dialog the destination is the user's choice and is
      // never reported back, so only name the file.
      const where = update.chosen ? update.filename : `Downloads/${update.filename}`;
      setStatus(`Saved to ${where} in ${update.seconds}s`, 'success');
      finish();
    } else if (update.type === 'cancelled') {
      setStatus(update.message);
      finish();
    } else if (update.type === 'error') {
      setStatus(update.message, 'error');
      finish();
    }
  });

  // Without this, a background that dies mid-run would leave the popup stuck
  // on a disabled "Starting…" state forever.
  port.onDisconnect.addListener(() => {
    if (finished) return;
    setBusy(false);
    activePort = undefined;
    setStatus('Lost the connection to the extension. The run may still finish and save.', 'error');
  });

  port.postMessage({ type: 'start', mode, page });
}

/** Show the synthesis as it streams, pinned to the newest text. */
function showPreview(text: string): void {
  previewEl.hidden = !text;
  previewEl.textContent = text;
  previewEl.scrollTop = previewEl.scrollHeight;
}

function setBusy(busy: boolean): void {
  clipButton.disabled = busy;
  summarizeButton.disabled = busy;
  cancelButton.hidden = !busy;
}

function setStatus(message: string, tone?: 'error' | 'success'): void {
  statusEl.textContent = message;
  statusEl.className = tone ? `status ${tone}` : 'status';
}
