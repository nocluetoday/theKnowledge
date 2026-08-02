import { ParsedSections, SECTION_TITLES, extractJsonBlock } from './sections';
import { formatDate } from './filename';

export interface NoteMetadata {
  title: string;
  source: string;
  date: Date;
  type: 'summary' | 'clip';
  provider?: string;
  model?: string;
  /** Set when the source was long enough to require multiple API calls. */
  chunks?: number;
}

/** Escape a value for a YAML double-quoted scalar. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(meta: NoteMetadata): string {
  const lines = [
    '---',
    `title: ${yamlString(meta.title)}`,
    `source: ${yamlString(meta.source)}`,
    `clipped: ${formatDate(meta.date)}`,
    `type: ${meta.type}`,
  ];
  if (meta.provider) lines.push(`provider: ${meta.provider}`);
  if (meta.model) lines.push(`model: ${yamlString(meta.model)}`);
  if (meta.chunks && meta.chunks > 1) lines.push(`chunks: ${meta.chunks}`);
  lines.push('---', '');
  return lines.join('\n');
}

/** Build a clip-mode note: frontmatter plus the cleaned markdown body. */
export function buildClipNote(meta: NoteMetadata, body: string): string {
  return `${buildFrontmatter(meta)}\n# ${meta.title}\n\n[Source](${meta.source})\n\n${body.trim()}\n`;
}

/**
 * Build a summary note, synthesis first: F, then C/D/E, with the atomic JSON
 * records (B) and the copying-risk audit (G) collapsed at the bottom.
 */
export function buildSummaryNote(meta: NoteMetadata, sections: ParsedSections): string {
  const parts: string[] = [buildFrontmatter(meta), `# ${meta.title}\n`, `[Source](${meta.source})\n`];

  const section = (key: keyof typeof SECTION_TITLES, level = '##') => {
    const body = sections[key];
    if (!body) return;
    parts.push(`${level} ${SECTION_TITLES[key]}\n\n${body.trim()}\n`);
  };

  section('F');
  section('C');
  section('D');
  section('E');
  section('A');

  const records = extractJsonBlock(sections.B);
  if (records || sections.G) {
    parts.push('<details>');
    parts.push('<summary>Atomic knowledge records and copying-risk audit</summary>\n');
    if (records) {
      parts.push(`### ${SECTION_TITLES.B}\n`);
      parts.push('```json');
      parts.push(records);
      parts.push('```\n');
    }
    if (sections.G) {
      parts.push(`### ${SECTION_TITLES.G}\n`);
      parts.push(`${sections.G.trim()}\n`);
    }
    parts.push('</details>\n');
  }

  return parts.join('\n');
}

/**
 * Fallback note used when section parsing fails: keep the entire model output
 * verbatim under a banner rather than silently losing it.
 */
export function buildRawFallbackNote(meta: NoteMetadata, raw: string): string {
  return [
    buildFrontmatter(meta),
    `# ${meta.title}\n`,
    `[Source](${meta.source})\n`,
    '> The model output could not be split into the expected A–G sections, so it is',
    '> reproduced verbatim below.\n',
    raw.trim(),
    '',
  ].join('\n');
}
