import { describe, expect, it } from 'vitest';
import { extractJsonBlock, mergeRecordArrays, parseSections } from '../src/lib/sections';

describe('parseSections', () => {
  it('parses plain "A." style headings', () => {
    const sections = parseSections(
      ['A. Source characterization', 'Urology review.', '', 'F. New clinical synthesis', 'Findings.'].join('\n'),
    );

    expect(sections.A).toBe('Urology review.');
    expect(sections.F).toBe('Findings.');
  });

  it('parses markdown-decorated headings', () => {
    const sections = parseSections(
      ['## A. Source characterization', 'Guideline.', '', '**B. Atomic knowledge records**', '[]'].join('\n'),
    );

    expect(sections.A).toBe('Guideline.');
    expect(sections.B).toBe('[]');
  });

  it('ignores out-of-order letters that appear inside body text', () => {
    const sections = parseSections(
      ['A. Source characterization', 'Options were A) this and B) that.', '', 'C. Canonical fact set', 'Facts.'].join('\n'),
    );

    expect(sections.A).toContain('A) this');
    expect(sections.C).toBe('Facts.');
    expect(sections.B).toBeUndefined();
  });

  it('returns an empty object when no headings are present', () => {
    expect(parseSections('Just prose with no section markers at all.')).toEqual({});
  });

  it('omits sections whose body is empty', () => {
    const sections = parseSections(['A. Source characterization', '', 'C. Canonical fact set', 'Facts.'].join('\n'));

    expect(sections.A).toBeUndefined();
    expect(sections.C).toBe('Facts.');
  });
});

describe('extractJsonBlock', () => {
  it('unwraps a fenced json block and pretty-prints it', () => {
    expect(extractJsonBlock('```json\n[{"claim_id":"c1-1"}]\n```')).toBe(
      JSON.stringify([{ claim_id: 'c1-1' }], null, 2),
    );
  });

  it('accepts bare JSON', () => {
    expect(extractJsonBlock('[{"a":1}]')).toBe(JSON.stringify([{ a: 1 }], null, 2));
  });

  it('returns the original text when JSON is malformed', () => {
    expect(extractJsonBlock('[{broken')).toBe('[{broken');
  });

  it('returns undefined for a missing section', () => {
    expect(extractJsonBlock(undefined)).toBeUndefined();
  });
});

describe('mergeRecordArrays', () => {
  it('concatenates arrays from each chunk', () => {
    const merged = JSON.parse(mergeRecordArrays(['[{"claim_id":"c1-1"}]', '[{"claim_id":"c2-1"}]']));

    expect(merged).toHaveLength(2);
    expect(merged[1].claim_id).toBe('c2-1');
  });

  it('unwraps an object that nests the record array', () => {
    const merged = JSON.parse(mergeRecordArrays(['{"records":[{"claim_id":"c1-1"}]}']));

    expect(merged).toEqual([{ claim_id: 'c1-1' }]);
  });

  it('keeps unparseable blocks rather than dropping them', () => {
    expect(mergeRecordArrays(['not json at all'])).toBe('not json at all');
  });

  it('skips unparseable blocks when at least one parses', () => {
    const merged = JSON.parse(mergeRecordArrays(['[{"claim_id":"c1-1"}]', 'garbage']));

    expect(merged).toHaveLength(1);
  });
});
