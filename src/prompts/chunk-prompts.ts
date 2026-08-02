/**
 * Prompt variants for the chunked pipeline. When a source is too long for one
 * call, each chunk runs stages 1–2 (sections A and B only) and a final merge
 * call runs stages 3–5 (sections C–G) over the combined records.
 */

/** Whole source fits in one call: the user's prompt runs verbatim. */
export function buildSinglePrompt(basePrompt: string, sourceText: string): string {
  return `${basePrompt}\n\n${sourceText}`;
}

/** Per-chunk call: characterization plus atomic extraction, nothing else. */
export function buildChunkPrompt(
  basePrompt: string,
  sourceText: string,
  chunkIndex: number,
  chunkCount: number,
): string {
  return [
    basePrompt,
    '',
    'CHUNK PROCESSING INSTRUCTIONS',
    '',
    `The source text below is part ${chunkIndex + 1} of ${chunkCount} of a longer document.`,
    'Perform STAGE 1 and STAGE 2 only on this part. Do not perform stages 3, 4, or 5,',
    'and do not write a synthesis — later parts have not been read yet.',
    '',
    'Return only these sections:',
    '',
    'A. Source characterization',
    '',
    'B. Atomic knowledge records in JSON',
    '',
    `Prefix every claim_id with "c${chunkIndex + 1}-" so records stay unique once the parts are combined.`,
    'Return section B as a single JSON array in a fenced code block.',
    '',
    'SOURCE TEXT',
    '',
    sourceText,
  ].join('\n');
}

/** Merge call: quality control, consolidation, and synthesis over merged records. */
export function buildMergePrompt(
  basePrompt: string,
  mergedRecordsJson: string,
  characterizations: string[],
): string {
  return [
    basePrompt,
    '',
    'MERGE INSTRUCTIONS',
    '',
    'The atomic knowledge records below were extracted from a long document that was',
    'processed in parts. STAGE 1 and STAGE 2 are already complete — do not repeat them,',
    'and do not ask for the original prose. Perform STAGE 3, STAGE 4, and STAGE 5 using',
    'only the records supplied here.',
    '',
    'Return only these sections:',
    '',
    'C. Canonical fact set',
    '',
    'D. Conflicts and uncertainties',
    '',
    'E. Verification queue',
    '',
    'F. New clinical synthesis',
    '',
    'G. Copying-risk audit',
    '',
    'SOURCE CHARACTERIZATIONS FROM EACH PART',
    '',
    characterizations.filter(Boolean).join('\n\n---\n\n'),
    '',
    'ATOMIC KNOWLEDGE RECORDS',
    '',
    '```json',
    mergedRecordsJson,
    '```',
  ].join('\n');
}
