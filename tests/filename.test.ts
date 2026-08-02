import { describe, expect, it } from 'vitest';
import {
  buildDownloadPath,
  buildFilename,
  formatDate,
  sanitizeSubfolder,
  slugifyTitle,
} from '../src/lib/filename';

describe('slugifyTitle', () => {
  it('strips characters the downloads API rejects', () => {
    expect(slugifyTitle('AUA/SUFU Guideline: BPH?')).toBe('AUA SUFU Guideline BPH');
  });

  it('collapses whitespace and trims', () => {
    expect(slugifyTitle('  Renal   cell\tcarcinoma  ')).toBe('Renal cell carcinoma');
  });

  it('falls back to "untitled" for empty or punctuation-only titles', () => {
    expect(slugifyTitle('')).toBe('untitled');
    expect(slugifyTitle('///')).toBe('untitled');
    expect(slugifyTitle('...')).toBe('untitled');
  });

  it('rejects Windows reserved device names', () => {
    expect(slugifyTitle('CON')).toBe('untitled');
    expect(slugifyTitle('lpt1')).toBe('untitled');
  });

  it('truncates very long titles', () => {
    expect(slugifyTitle('a'.repeat(200))).toHaveLength(80);
  });

  it('removes leading dots so the note is not hidden', () => {
    expect(slugifyTitle('.hidden note')).toBe('hidden note');
  });
});

describe('formatDate', () => {
  it('zero-pads month and day', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('buildFilename', () => {
  it('prefixes the date and appends the markdown extension', () => {
    expect(buildFilename('HoLEP outcomes', new Date(2026, 7, 1))).toBe('2026-08-01 HoLEP outcomes.md');
  });
});

describe('sanitizeSubfolder', () => {
  it('keeps a simple nested path', () => {
    expect(sanitizeSubfolder('MedKnowledge/Urology')).toBe('MedKnowledge/Urology');
  });

  it('drops traversal segments and leading slashes', () => {
    expect(sanitizeSubfolder('/../../etc')).toBe('etc');
    expect(sanitizeSubfolder('..')).toBe('');
  });

  it('strips illegal characters within a segment', () => {
    expect(sanitizeSubfolder('Med:Knowledge')).toBe('MedKnowledge');
  });
});

describe('buildDownloadPath', () => {
  it('joins subfolder and filename', () => {
    expect(buildDownloadPath('MedKnowledge', 'note.md')).toBe('MedKnowledge/note.md');
  });

  it('returns the bare filename when the subfolder sanitizes to nothing', () => {
    expect(buildDownloadPath('..', 'note.md')).toBe('note.md');
  });
});
