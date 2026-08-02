/** Message contracts between popup, background, and content script. */

export type ClipMode = 'clip' | 'summarize';

export interface PageInfo {
  tabId: number;
  url: string;
  title: string;
  kind: 'html' | 'pdf';
}

export interface StartRequest {
  type: 'start';
  mode: ClipMode;
  page: PageInfo;
}

/** The user clicked Cancel in the popup; the in-flight run should abort. */
export interface CancelRequest {
  type: 'cancel';
}

export interface DetectRequest {
  type: 'detect';
}

export type PopupRequest = StartRequest | CancelRequest | DetectRequest;

export interface ProgressUpdate {
  type: 'progress';
  message: string;
}

/** Streamed synthesis text so far, so the popup can show it being written. */
export interface PartialUpdate {
  type: 'partial';
  text: string;
}

export interface DoneUpdate {
  type: 'done';
  filename: string;
  /**
   * True when the user picked the destination in the Save As dialog, so the
   * final location is unknown to the extension and must not be reported as
   * being under Downloads.
   */
  chosen: boolean;
  /** Wall-clock seconds from click to saved file. */
  seconds: number;
}

/**
 * The run stopped at the user's request — either the Cancel button or a
 * dismissed Save As dialog. Expected, so not shown as an error.
 */
export interface CancelledUpdate {
  type: 'cancelled';
  message: string;
}

export interface ErrorUpdate {
  type: 'error';
  message: string;
}

export type RunUpdate = ProgressUpdate | PartialUpdate | DoneUpdate | CancelledUpdate | ErrorUpdate;

/** Result returned by the content script's Readability pass. */
export interface ArticleExtraction {
  title: string;
  html: string;
  text: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
}

export interface ExtractArticleRequest {
  type: 'extract-article';
}
