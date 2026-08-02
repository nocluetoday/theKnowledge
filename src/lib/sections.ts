/**
 * Parse the A–G output sections produced by the extraction prompt.
 *
 * Models vary in how they render the headings (`A. Source characterization`,
 * `## A. Source characterization`, `**A. Source characterization**`), so the
 * matcher is deliberately loose. Parsing is best-effort: when nothing matches,
 * the caller falls back to saving the raw output.
 */

export type SectionKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export const SECTION_KEYS: SectionKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const SECTION_TITLES: Record<SectionKey, string> = {
  A: 'Source characterization',
  B: 'Atomic knowledge records',
  C: 'Canonical fact set',
  D: 'Conflicts and uncertainties',
  E: 'Verification queue',
  F: 'Clinical synthesis',
  G: 'Copying-risk audit',
};

export type ParsedSections = Partial<Record<SectionKey, string>>;

/** Matches a line that is (only) a section heading, with optional markdown decoration. */
const HEADING = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*([A-G])[.):]\s*([^\n*_#]{0,80}?)\s*(?:\*\*|__)?\s*$/;

/**
 * Split a model response into its A–G sections.
 * Returns an empty object when no headings are recognized.
 */
export function parseSections(response: string): ParsedSections {
  const lines = response.split('\n');
  const found: Array<{ key: SectionKey; start: number }> = [];

  lines.forEach((line, index) => {
    const match = HEADING.exec(line);
    if (!match) return;
    const key = match[1] as SectionKey;
    // Headings must appear in order; ignore stray "A)" inside body text.
    if (found.length && SECTION_KEYS.indexOf(key) <= SECTION_KEYS.indexOf(found[found.length - 1].key)) {
      return;
    }
    found.push({ key, start: index });
  });

  if (found.length === 0) return {};

  const sections: ParsedSections = {};
  found.forEach((entry, i) => {
    const end = i + 1 < found.length ? found[i + 1].start : lines.length;
    const body = lines.slice(entry.start + 1, end).join('\n').trim();
    if (body) sections[entry.key] = body;
  });

  return sections;
}

/**
 * Pull the JSON array of atomic records out of section B, whether it arrived
 * fenced or bare. Returns the pretty-printed JSON when parseable, otherwise the
 * original text so nothing is lost.
 */
export function extractJsonBlock(sectionB: string | undefined): string | undefined {
  if (!sectionB) return undefined;

  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(sectionB);
  const candidate = (fenced ? fenced[1] : sectionB).trim();

  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return candidate;
  }
}

/** Merge the atomic-record arrays returned by each chunk into one JSON array. */
export function mergeRecordArrays(jsonBlocks: string[]): string {
  const merged: unknown[] = [];
  const unparseable: string[] = [];

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        merged.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        // Some responses wrap the array, e.g. {"records": [...]}.
        const nested = Object.values(parsed).find(Array.isArray);
        if (nested) merged.push(...(nested as unknown[]));
        else merged.push(parsed);
      }
    } catch {
      unparseable.push(block);
    }
  }

  if (merged.length === 0 && unparseable.length > 0) {
    // Nothing parsed — hand the raw blocks to the merge call rather than dropping them.
    return unparseable.join('\n\n');
  }

  return JSON.stringify(merged, null, 2);
}
