import { describe, expect, it } from 'vitest';
import { buildClipNote, buildRawFallbackNote, buildSummaryNote, NoteMetadata } from '../src/lib/note-builder';

const meta: NoteMetadata = {
  title: 'Ureteral stent dwell time',
  source: 'https://example.org/stents',
  date: new Date(2026, 7, 1),
  type: 'summary',
  provider: 'anthropic',
  model: 'claude-opus-5',
};

describe('buildSummaryNote', () => {
  const sections = {
    A: 'Urology guideline.',
    B: '```json\n[{"claim_id":"c1-1"}]\n```',
    C: 'Canonical facts.',
    D: 'One conflict.',
    E: 'Verify dosing.',
    F: 'The synthesis.',
    G: 'No copying risk found.',
  };

  it('writes frontmatter with the source, model, and date', () => {
    const note = buildSummaryNote(meta, sections);

    expect(note).toMatch(/^---\n/);
    expect(note).toContain('source: "https://example.org/stents"');
    expect(note).toContain('clipped: 2026-08-01');
    expect(note).toContain('provider: anthropic');
    expect(note).toContain('model: "claude-opus-5"');
  });

  it('leads with the synthesis, ahead of the canonical facts', () => {
    const note = buildSummaryNote(meta, sections);

    expect(note.indexOf('The synthesis.')).toBeLessThan(note.indexOf('Canonical facts.'));
  });

  it('collapses the records and audit into a details block at the end', () => {
    const note = buildSummaryNote(meta, sections);

    expect(note).toContain('<details>');
    expect(note.indexOf('<details>')).toBeGreaterThan(note.indexOf('The synthesis.'));
    expect(note).toContain('"claim_id": "c1-1"');
    expect(note).toContain('No copying risk found.');
  });

  it('omits the details block when there are no records or audit', () => {
    const note = buildSummaryNote(meta, { F: 'Only a synthesis.' });

    expect(note).not.toContain('<details>');
    expect(note).toContain('Only a synthesis.');
  });

  it('records the chunk count only when the source was split', () => {
    expect(buildSummaryNote({ ...meta, chunks: 3 }, sections)).toContain('chunks: 3');
    expect(buildSummaryNote({ ...meta, chunks: 1 }, sections)).not.toContain('chunks:');
  });

  it('escapes quotes in the title so the frontmatter stays valid YAML', () => {
    const note = buildSummaryNote({ ...meta, title: 'The "gold standard"' }, sections);

    expect(note).toContain('title: "The \\"gold standard\\""');
  });
});

describe('buildClipNote', () => {
  it('flattens newlines in the title so the frontmatter and heading stay on one line', () => {
    // PDF metadata titles can contain line breaks; tab titles cannot.
    const note = buildClipNote({ ...meta, type: 'clip', title: 'Line one\nLine two' }, 'Body.');

    expect(note).toContain('title: "Line one Line two"');
    expect(note).toContain('# Line one Line two');
  });

  it('emits frontmatter, a heading, and the body', () => {
    const note = buildClipNote({ ...meta, type: 'clip' }, '## Findings\n\nText.');

    expect(note).toContain('type: clip');
    expect(note).toContain('# Ureteral stent dwell time');
    expect(note).toContain('## Findings');
  });
});

describe('buildRawFallbackNote', () => {
  it('preserves the model output verbatim under a banner', () => {
    const note = buildRawFallbackNote(meta, 'Unstructured model output.');

    expect(note).toContain('could not be split into the expected A–G sections');
    expect(note).toContain('Unstructured model output.');
  });
});
