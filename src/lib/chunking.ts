/**
 * Split long source text into chunks the summarizer can process one API call at
 * a time. Splits are attempted on the highest-level boundary available: PDF page
 * markers first, then paragraphs, then lines, then a hard character cut.
 */

/** Marker `extract-pdf.ts` writes between pages; also our preferred split point. */
export const PAGE_MARKER = /^## Page \d+$/m;

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  chunkSize: number;
  /**
   * Chunks shorter than this fraction of `chunkSize` are merged into the
   * previous chunk rather than sent as their own API call.
   */
  minTailRatio?: number;
}

const DEFAULT_MIN_TAIL_RATIO = 0.25;

/**
 * Split `text` into pieces of at most `chunkSize` characters.
 * Returns a single-element array when the text already fits.
 */
export function chunkText(text: string, options: ChunkOptions): string[] {
  const { chunkSize, minTailRatio = DEFAULT_MIN_TAIL_RATIO } = options;
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const units = splitIntoUnits(trimmed, chunkSize);
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
    } else if (current.length + unit.length + 2 <= chunkSize) {
      current = `${current}\n\n${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);

  // Merge an undersized final chunk back into its predecessor.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    if (last.length < chunkSize * minTailRatio && previous.length + last.length + 2 <= chunkSize * 1.2) {
      chunks.splice(chunks.length - 2, 2, `${previous}\n\n${last}`);
    }
  }

  return chunks;
}

/**
 * Break text into the largest units that each fit within `chunkSize`,
 * descending through page → paragraph → line → hard cut.
 */
function splitIntoUnits(text: string, chunkSize: number): string[] {
  const pages = splitKeepingDelimiter(text, PAGE_MARKER);
  const units: string[] = [];

  for (const page of pages) {
    if (page.length <= chunkSize) {
      units.push(page);
      continue;
    }
    for (const paragraph of page.split(/\n{2,}/)) {
      if (paragraph.length <= chunkSize) {
        if (paragraph.trim()) units.push(paragraph.trim());
        continue;
      }
      for (const line of splitLongParagraph(paragraph, chunkSize)) {
        units.push(line);
      }
    }
  }

  return units.filter((unit) => unit.trim().length > 0);
}

/** Split on a line-anchored pattern, keeping the matched line with the text that follows it. */
function splitKeepingDelimiter(text: string, pattern: RegExp): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (pattern.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join('\n').trim());
  return sections.filter(Boolean);
}

/** Last resort: split an oversized paragraph on lines, then on raw characters. */
function splitLongParagraph(paragraph: string, chunkSize: number): string[] {
  const pieces: string[] = [];
  let buffer = '';

  for (const line of paragraph.split('\n')) {
    if (line.length > chunkSize) {
      if (buffer) {
        pieces.push(buffer);
        buffer = '';
      }
      for (let i = 0; i < line.length; i += chunkSize) {
        pieces.push(line.slice(i, i + chunkSize));
      }
      continue;
    }
    if (buffer.length + line.length + 1 <= chunkSize) {
      buffer = buffer ? `${buffer}\n${line}` : line;
    } else {
      pieces.push(buffer);
      buffer = line;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}
