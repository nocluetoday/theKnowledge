/**
 * Prompt variants for the chunked pipeline. When a source is too long for one
 * call, each chunk runs stages 1–2 (sections A and B only) and a final merge
 * call runs stages 3–5 (sections C–G) over the combined records.
 */

/** Whole source fits in one call: the user's prompt runs verbatim. */
export function buildSinglePrompt(basePrompt: string, sourceText: string): string {
  return `${basePrompt}\n\n${sourceText}`;
}

/**
 * Synthesis-only single call.
 *
 * The staged extraction still happens — that discipline is the whole point of
 * the prompt — but only section F is written out. Emitting the per-claim JSON
 * records is what makes the full mode slow, and they are collapsed out of sight
 * in the note anyway.
 */
export function buildSynthesisPrompt(basePrompt: string, sourceText: string): string {
  return [
    basePrompt,
    '',
    'OUTPUT INSTRUCTIONS — OVERRIDE THE OUTPUT FORMAT ABOVE',
    '',
    'Carry out STAGE 1 through STAGE 4 as reasoning only. Do not write out the',
    'source characterization, the atomic knowledge records, the canonical fact set,',
    'the conflict list, or the copying-risk audit.',
    '',
    'Write out one section only:',
    '',
    'F. New clinical synthesis',
    '',
    'Every requirement on the synthesis still applies: build it from the facts you',
    'extracted rather than from the source prose, use a new structure and original',
    'wording, keep every clinically important qualifier and numerical value,',
    'distinguish evidence from opinion, and say so where the evidence is limited.',
    'Since the records are not being shown, omit the claim_id citations.',
    '',
    'SOURCE TEXT',
    '',
    sourceText,
  ].join('\n');
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

/**
 * Per-chunk call in synthesis mode: compact fact bullets instead of the
 * 20-field JSON records. Chunked runs still need an intermediate the merge step
 * can consume, but it does not have to be the full record payload.
 */
export function buildChunkFactsPrompt(
  basePrompt: string,
  sourceText: string,
  chunkIndex: number,
  chunkCount: number,
): string {
  return [
    basePrompt,
    '',
    'OUTPUT INSTRUCTIONS — OVERRIDE THE OUTPUT FORMAT ABOVE',
    '',
    `The source text below is part ${chunkIndex + 1} of ${chunkCount} of a longer document.`,
    'Apply the extraction rules above to this part only. Do not write a synthesis —',
    'later parts have not been read yet — and do not emit JSON.',
    '',
    'Write a flat list of factual bullets, one claim per line, each self-contained.',
    'Preserve every numerical value, dose, threshold, unit, and qualifier exactly.',
    'Mark each bullet with its nature in brackets, one of: [fact], [association],',
    '[guideline], [opinion], [uncertain]. Do not group, rank, or introduce them.',
    '',
    'SOURCE TEXT',
    '',
    sourceText,
  ].join('\n');
}

/**
 * Merge call in synthesis mode: turn the combined fact bullets into the
 * synthesis, and nothing else.
 */
export function buildSynthesisMergePrompt(basePrompt: string, facts: string): string {
  return [
    basePrompt,
    '',
    'OUTPUT INSTRUCTIONS — OVERRIDE THE OUTPUT FORMAT ABOVE',
    '',
    'The facts below were extracted from a long document processed in parts. The',
    'extraction stages are complete; do not ask for the original prose. Consolidate',
    'duplicates, keep genuine conflicts visible in the prose, and write out one',
    'section only:',
    '',
    'F. New clinical synthesis',
    '',
    'Build it only from the facts supplied. Keep every clinically important',
    'qualifier and numerical value, distinguish evidence from opinion, and state',
    'where the evidence is limited or the parts disagree. Omit claim_id citations.',
    '',
    'EXTRACTED FACTS',
    '',
    facts,
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
