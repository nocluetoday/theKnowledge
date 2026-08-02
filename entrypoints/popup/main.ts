import type { ClipMode, PageInfo, RunUpdate } from '../../src/lib/messages';

const titleEl = document.getElementById('page-title') as HTMLHeadingElement;
const kindEl = document.getElementById('page-kind') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const clipButton = document.getElementById('clip') as HTMLButtonElement;
const summarizeButton = document.getElementById('summarize') as HTMLButtonElement;
const settingsButton = document.getElementById('settings') as HTMLButtonElement;

let page: PageInfo | undefined;

settingsButton.addEventListener('click', () => browser.runtime.openOptionsPage());
clipButton.addEventListener('click', () => start('clip'));
summarizeButton.addEventListener('click', () => start('summarize'));

void init();

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url || !/^(https?|file):/.test(tab.url)) {
    titleEl.textContent = 'Unsupported page';
    setStatus('Open a web page or PDF to clip it.', 'error');
    return;
  }

  page = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title ?? 'Untitled',
    kind: (await isPdf(tab.url)) ? 'pdf' : 'html',
  };

  titleEl.textContent = page.title;
  kindEl.textContent = page.kind === 'pdf' ? 'PDF document' : 'Web page';
  clipButton.disabled = false;
  summarizeButton.disabled = false;
}

/** URL extension first; fall back to a HEAD content-type sniff. */
async function isPdf(url: string): Promise<boolean> {
  if (/\.pdf(?:[?#]|$)/i.test(url)) return true;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf');
  } catch {
    return false;
  }
}

function start(mode: ClipMode): void {
  if (!page) return;

  setBusy(true);
  setStatus(mode === 'clip' ? 'Clipping…' : 'Starting…');

  const port = browser.runtime.connect({ name: 'clipper' });

  port.onMessage.addListener((raw: unknown) => {
    const update = raw as RunUpdate;
    if (update.type === 'progress') {
      setStatus(update.message);
    } else if (update.type === 'done') {
      setStatus(`Saved to Downloads/${update.filename}`, 'success');
      setBusy(false);
      port.disconnect();
    } else if (update.type === 'error') {
      setStatus(update.message, 'error');
      setBusy(false);
      port.disconnect();
    }
  });

  port.postMessage({ type: 'start', mode, page });
}

function setBusy(busy: boolean): void {
  clipButton.disabled = busy;
  summarizeButton.disabled = busy;
}

function setStatus(message: string, tone?: 'error' | 'success'): void {
  statusEl.textContent = message;
  statusEl.className = tone ? `status ${tone}` : 'status';
}
