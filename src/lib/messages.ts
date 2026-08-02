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

export interface DetectRequest {
  type: 'detect';
}

export type PopupRequest = StartRequest | DetectRequest;

export interface ProgressUpdate {
  type: 'progress';
  message: string;
}

export interface DoneUpdate {
  type: 'done';
  filename: string;
}

export interface ErrorUpdate {
  type: 'error';
  message: string;
}

export type RunUpdate = ProgressUpdate | DoneUpdate | ErrorUpdate;

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
