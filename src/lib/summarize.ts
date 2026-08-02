import { chunkText } from './chunking';
import { getProvider, ProviderError } from './providers';
import { ParsedSections, parseSections, extractJsonBlock, mergeRecordArrays } from './sections';
import { buildChunkPrompt, buildMergePrompt, buildSinglePrompt } from '../prompts/chunk-prompts';
import type { Settings } from './settings';

export interface SummarizeResult {
  sections: ParsedSections;
  /** Present when section parsing failed, so the caller can save the raw output. */
  raw?: string;
  chunks: number;
}

export type ProgressFn = (message: string) => void;

/** One retry per call: transient network and rate-limit failures are common. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      return await fn();
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      throw new ProviderError(`${label} failed after a retry: ${message}`);
    }
  }
}

/**
 * Run the extraction prompt over `sourceText`, chunking when it exceeds the
 * configured chunk size.
 *
 * Single chunk: the prompt runs verbatim and yields sections A–G.
 * Multiple chunks: each chunk yields A+B, then a merge call turns the combined
 * records into C–G.
 */
export async function summarize(
  sourceText: string,
  settings: Settings,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<SummarizeResult> {
  const providerSettings = settings.providers[settings.provider];
  if (!providerSettings.apiKey.trim()) {
    throw new ProviderError(
      `No API key set for ${settings.provider}. Add one in the extension's settings.`,
    );
  }

  const provider = getProvider(settings.provider);
  const call = (prompt: string) =>
    provider.complete({
      apiKey: providerSettings.apiKey.trim(),
      model: providerSettings.model.trim(),
      prompt,
      maxTokens: settings.maxOutputTokens,
      signal,
    });

  const chunks = chunkText(sourceText, { chunkSize: settings.chunkSize });
  if (chunks.length === 0) throw new Error('No text could be extracted from this page.');

  if (chunks.length === 1) {
    onProgress('Summarizing…');
    const response = await withRetry(
      () => call(buildSinglePrompt(settings.extractionPrompt, chunks[0])),
      'The summary request',
    );
    const sections = parseSections(response);
    return Object.keys(sections).length > 0
      ? { sections, chunks: 1 }
      : { sections: {}, raw: response, chunks: 1 };
  }

  // Stage 1–2 per chunk.
  const characterizations: string[] = [];
  const recordBlocks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    onProgress(`Extracting facts — part ${i + 1} of ${chunks.length}…`);
    const response = await withRetry(
      () => call(buildChunkPrompt(settings.extractionPrompt, chunks[i], i, chunks.length)),
      `Part ${i + 1} of ${chunks.length}`,
    );
    const sections = parseSections(response);
    if (sections.A) characterizations.push(sections.A);
    const records = extractJsonBlock(sections.B) ?? extractJsonBlock(response);
    if (records) recordBlocks.push(records);
  }

  if (recordBlocks.length === 0) {
    throw new ProviderError(
      'No knowledge records came back from any part of the document. Try a different model.',
    );
  }

  // Stages 3–5 over the merged record set.
  onProgress('Merging and writing the synthesis…');
  const merged = mergeRecordArrays(recordBlocks);
  const mergeResponse = await withRetry(
    () => call(buildMergePrompt(settings.extractionPrompt, merged, characterizations)),
    'The merge request',
  );

  const mergeSections = parseSections(mergeResponse);
  if (Object.keys(mergeSections).length === 0) {
    return { sections: {}, raw: mergeResponse, chunks: chunks.length };
  }

  // Carry the per-chunk records and characterizations into the final note.
  return {
    sections: {
      ...mergeSections,
      A: mergeSections.A ?? characterizations.join('\n\n---\n\n'),
      B: `\`\`\`json\n${merged}\n\`\`\``,
    },
    chunks: chunks.length,
  };
}
