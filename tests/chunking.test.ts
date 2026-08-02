import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/lib/chunking';

describe('chunkText', () => {
  it('returns a single chunk when the text already fits', () => {
    expect(chunkText('short text', { chunkSize: 100 })).toEqual(['short text']);
  });

  it('returns nothing for empty input', () => {
    expect(chunkText('   \n  ', { chunkSize: 100 })).toEqual([]);
  });

  it('splits on PDF page markers', () => {
    const text = ['## Page 1', '', 'a'.repeat(60), '', '## Page 2', '', 'b'.repeat(60)].join('\n');
    const chunks = chunkText(text, { chunkSize: 100, minTailRatio: 0 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('## Page 1');
    expect(chunks[1]).toContain('## Page 2');
    expect(chunks[0]).not.toContain('## Page 2');
  });

  it('splits on paragraph boundaries when a page is oversized', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `p${i} ${'x'.repeat(40)}`);
    const chunks = chunkText(paragraphs.join('\n\n'), { chunkSize: 100, minTailRatio: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it('hard-cuts a single line longer than the chunk size', () => {
    const chunks = chunkText('y'.repeat(250), { chunkSize: 100, minTailRatio: 0 });

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it('preserves all content across chunks', () => {
    const text = Array.from({ length: 20 }, (_, i) => `paragraph ${i}`).join('\n\n');
    const rejoined = chunkText(text, { chunkSize: 60, minTailRatio: 0 }).join('\n\n');

    for (let i = 0; i < 20; i++) expect(rejoined).toContain(`paragraph ${i}`);
  });

  it('merges an undersized tail chunk into the previous one', () => {
    const text = `${'a'.repeat(95)}\n\ntiny`;
    const chunks = chunkText(text, { chunkSize: 100, minTailRatio: 0.5 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('tiny');
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkText('text', { chunkSize: 0 })).toThrow(/positive/);
  });
});
