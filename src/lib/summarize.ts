import { chunkText } from './chunking';
import { getProvider, ProviderError } from './providers';
import { ParsedSections, parseSections, extractJsonBlock, mergeRecordArrays } from './sections';
import {
  buildChunkFactsPrompt,
  buildChunkPrompt,
  buildMergePrompt,
  buildSinglePrompt,
  buildSynthesisMergePrompt,
  buildSynthesisPrompt,
} from '../prompts/chunk-prompts';
import type { Settings } from './settings';

export interface SummarizeResult {
  sections: ParsedSections;
  /** Present when section parsing failed, so the caller can save the raw output. */
  raw?: string;
  chunks: number;
}

export type ProgressFn = (message: string) => void;

/** How many chunk requests may be in flight at once, to stay clear of rate limits. */
const MAX_CONCURRENT_CHUNKS = 4;

/** Rejections that will never succeed on a second attempt. */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const status = error.status;
  // 429 is a rate limit and worth retrying; other 4xx are not.
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

/** One retry per call: transient network and rate-limit failures are common. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // A bad key or malformed request should fail immediately rather than making
    // the user wait out a pointless retry.
    if (isPermanent(error)) throw error;

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
 * Run `worker` over every item, at most `limit` at a time, preserving order.
 * Stops taking new items once `signal` aborts; items already in flight finish
 * (or fail) on their own.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (signal?.aborted) return;
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Run the extraction prompt over `sourceText`, chunking when it exceeds the
 * configured chunk size.
 *
 * In `synthesis` detail mode only the clinical synthesis is generated; in `full`
 * mode the whole A–G output is produced. Chunks are processed concurrently, so
 * a long document costs roughly the slowest chunk plus the merge rather than the
 * sum of every chunk.
 */
export async function summarize(
  sourceText: string,
  settings: Settings,
  onProgress: ProgressFn,
  signal?: AbortSignal,
  onToken?: (text: string) => void,
): Promise<SummarizeResult> {
  const providerSettings = settings.providers[settings.provider];
  if (!providerSettings.apiKey.trim()) {
    throw new ProviderError(
      `No API key set for ${settings.provider}. Add one in the extension's settings.`,
    );
  }

  const provider = getProvider(settings.provider);

  // Once any call fails for good, the whole run is doomed — stop the other
  // chunk requests rather than letting them spend tokens on a result that will
  // be thrown away.
  const failFast = new AbortController();
  const runSignal = signal ? AbortSignal.any([signal, failFast.signal]) : failFast.signal;

  const call = (prompt: string, stream = false) =>
    provider.complete({
      apiKey: providerSettings.apiKey.trim(),
      model: providerSettings.model.trim(),
      prompt,
      maxTokens: settings.maxOutputTokens,
      effort: settings.effort,
      preferFastestProvider: settings.preferFastestProvider,
      // Only the call that writes the synthesis is worth streaming; the
      // intermediate extraction passes produce nothing a reader wants to watch.
      onToken: stream ? onToken : undefined,
      signal: runSignal,
    });

  const synthesisOnly = settings.detail === 'synthesis';
  const chunks = chunkText(sourceText, { chunkSize: settings.chunkSize });
  if (chunks.length === 0) throw new Error('No text could be extracted from this page.');

  if (chunks.length === 1) {
    onProgress('Summarizing…');
    const prompt = synthesisOnly
      ? buildSynthesisPrompt(settings.extractionPrompt, chunks[0])
      : buildSinglePrompt(settings.extractionPrompt, chunks[0]);

    const response = await withRetry(() => call(prompt, true), 'The summary request');
    return finish(response, 1, synthesisOnly);
  }

  // Every chunk runs concurrently; the merge is a genuine barrier.
  onProgress(`Extracting facts from ${chunks.length} parts…`);
  let completed = 0;

  const responses = await mapWithConcurrency(
    chunks,
    MAX_CONCURRENT_CHUNKS,
    async (chunk, index) => {
      const prompt = synthesisOnly
        ? buildChunkFactsPrompt(settings.extractionPrompt, chunk, index, chunks.length)
        : buildChunkPrompt(settings.extractionPrompt, chunk, index, chunks.length);

      try {
        const response = await withRetry(() => call(prompt), `Part ${index + 1} of ${chunks.length}`);
        onProgress(`Extracted ${++completed} of ${chunks.length} parts…`);
        return response;
      } catch (error) {
        failFast.abort();
        throw error;
      }
    },
    failFast.signal,
  );

  onProgress('Writing the synthesis…');

  if (synthesisOnly) {
    const facts = responses.map((response) => response.trim()).filter(Boolean).join('\n');
    if (!facts) {
      throw new ProviderError('No facts came back from any part of the document. Try a different model.');
    }
    const merged = await withRetry(
      () => call(buildSynthesisMergePrompt(settings.extractionPrompt, facts), true),
      'The merge request',
    );
    return finish(merged, chunks.length, true);
  }

  const characterizations: string[] = [];
  const recordBlocks: string[] = [];
  for (const response of responses) {
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

  const mergedRecords = mergeRecordArrays(recordBlocks);
  const mergeResponse = await withRetry(
    () => call(buildMergePrompt(settings.extractionPrompt, mergedRecords, characterizations), true),
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
      B: `\`\`\`json\n${mergedRecords}\n\`\`\``,
    },
    chunks: chunks.length,
  };
}

/**
 * Turn a model response into sections. In synthesis mode the model was asked for
 * a single section, so a response with no recognizable heading is still a valid
 * synthesis rather than a parse failure.
 */
function finish(response: string, chunks: number, synthesisOnly: boolean): SummarizeResult {
  const sections = parseSections(response);
  if (Object.keys(sections).length > 0) return { sections, chunks };
  if (synthesisOnly && response.trim()) return { sections: { F: response.trim() }, chunks };
  return { sections: {}, raw: response, chunks };
}
