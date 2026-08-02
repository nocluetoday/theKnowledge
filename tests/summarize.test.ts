import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarize } from '../src/lib/summarize';
import { DEFAULT_SETTINGS, Settings } from '../src/lib/settings';

function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    // Most existing cases assert the full A–G pipeline; synthesis mode is the
    // shipped default and is covered separately below.
    detail: 'full',
    ...overrides,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      anthropic: { apiKey: 'test-key', model: 'claude-opus-5' },
    },
  };
}

/**
 * Stub the Anthropic endpoint, returning each scripted reply in turn.
 *
 * `delayMs` holds each response open so concurrency can be observed: the tests
 * track how many requests are in flight simultaneously.
 */
function stubReplies(replies: string[], delayMs = 0) {
  const prompts: string[] = [];
  let call = 0;
  let inFlight = 0;
  let peakInFlight = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      prompts.push(JSON.parse(options.body as string).messages[0].content);
      const text = replies[Math.min(call++, replies.length - 1)];

      peakInFlight = Math.max(peakInFlight, ++inFlight);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      inFlight--;

      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) };
    }),
  );

  return { prompts, callCount: () => call, peakInFlight: () => peakInFlight };
}

const FULL_RESPONSE = [
  'A. Source characterization',
  'A urology guideline.',
  '',
  'B. Atomic knowledge records in JSON',
  '```json',
  '[{"claim_id":"c1-1","normalized_fact":"T1a renal tumors are 4 cm or less."}]',
  '```',
  '',
  'C. Canonical fact set',
  'T1a tumors measure 4 cm or less.',
  '',
  'D. Conflicts and uncertainties',
  'None identified.',
  '',
  'E. Verification queue',
  'Confirm staging against current AJCC.',
  '',
  'F. New clinical synthesis',
  'Partial nephrectomy is preferred for small renal masses. [c1-1]',
  '',
  'G. Copying-risk audit',
  'No matching phrases longer than eight words.',
].join('\n');

const CHUNK_RESPONSE = (n: number) =>
  [
    'A. Source characterization',
    `Part ${n} of a guideline.`,
    '',
    'B. Atomic knowledge records in JSON',
    '```json',
    `[{"claim_id":"c${n}-1","normalized_fact":"Fact from part ${n}."}]`,
    '```',
  ].join('\n');

const MERGE_RESPONSE = [
  'C. Canonical fact set',
  'Merged facts.',
  '',
  'D. Conflicts and uncertainties',
  'One conflict between parts.',
  '',
  'E. Verification queue',
  'Verify dosing.',
  '',
  'F. New clinical synthesis',
  'The merged synthesis. [c1-1][c2-1]',
  '',
  'G. Copying-risk audit',
  'Materially independent.',
].join('\n');

afterEach(() => vi.unstubAllGlobals());

describe('summarize — single chunk', () => {
  it('makes one call and returns all parsed sections', async () => {
    const stub = stubReplies([FULL_RESPONSE]);

    const result = await summarize('Short source text.', settingsWith(), () => {});

    expect(stub.callCount()).toBe(1);
    expect(result.chunks).toBe(1);
    expect(result.raw).toBeUndefined();
    expect(result.sections.F).toContain('Partial nephrectomy is preferred');
    expect(result.sections.G).toContain('No matching phrases');
  });

  it('sends the source text appended to the configured prompt', async () => {
    const stub = stubReplies([FULL_RESPONSE]);

    await summarize('UNIQUE SOURCE MARKER', settingsWith({ extractionPrompt: 'CUSTOM PROMPT' }), () => {});

    expect(stub.prompts[0]).toContain('CUSTOM PROMPT');
    expect(stub.prompts[0]).toContain('UNIQUE SOURCE MARKER');
  });

  it('falls back to raw output when no sections can be parsed', async () => {
    stubReplies(['Just unstructured prose, no headings anywhere.']);

    const result = await summarize('Short text.', settingsWith(), () => {});

    expect(result.raw).toBe('Just unstructured prose, no headings anywhere.');
    expect(result.sections).toEqual({});
  });
});

describe('summarize — chunked', () => {
  const longSource = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'x'.repeat(50)}`).join('\n\n');
  const chunkedSettings = settingsWith({ chunkSize: 500 });

  it('extracts each chunk, then merges into one synthesis', async () => {
    const stub = stubReplies([CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE]);

    const result = await summarize(longSource, chunkedSettings, () => {});

    expect(result.chunks).toBeGreaterThan(1);
    // One call per chunk, plus the merge call.
    expect(stub.callCount()).toBe(result.chunks + 1);
    expect(result.sections.F).toBe('The merged synthesis. [c1-1][c2-1]');
  });

  it('tells each chunk call to stop after stage 2', async () => {
    const stub = stubReplies([CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE]);

    await summarize(longSource, chunkedSettings, () => {});

    expect(stub.prompts[0]).toContain('Perform STAGE 1 and STAGE 2 only');
    expect(stub.prompts[0]).toMatch(/part 1 of \d+/);
  });

  it('passes the merged records, not the prose, to the merge call', async () => {
    const stub = stubReplies([CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE]);

    const result = await summarize(longSource, chunkedSettings, () => {});
    const mergePrompt = stub.prompts[stub.prompts.length - 1];

    expect(mergePrompt).toContain('Perform STAGE 3, STAGE 4, and STAGE 5');
    expect(mergePrompt).toContain('Fact from part 1.');
    expect(mergePrompt).toContain('Fact from part 2.');
    expect(mergePrompt).not.toContain('Paragraph 0');
    // Records from every chunk survive into the saved note.
    expect(result.sections.B).toContain('Fact from part 1.');
  });

  it('reports progress for each part and the merge', async () => {
    stubReplies([CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE]);
    const updates: string[] = [];

    await summarize(longSource, chunkedSettings, (message) => updates.push(message));

    expect(updates.some((u) => /Extracting facts from \d+ parts/.test(u))).toBe(true);
    expect(updates.some((u) => /Extracted \d+ of \d+ parts/.test(u))).toBe(true);
    expect(updates.at(-1)).toMatch(/Writing the synthesis/);
  });
});

describe('summarize — concurrency', () => {
  const longSource = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'x'.repeat(50)}`).join('\n\n');

  it('runs chunk calls concurrently rather than one after another', async () => {
    const stub = stubReplies(
      [CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE],
      20,
    );

    const result = await summarize(longSource, settingsWith({ chunkSize: 500 }), () => {});

    expect(result.chunks).toBeGreaterThan(1);
    // Sequential execution would never exceed one request in flight.
    expect(stub.peakInFlight()).toBeGreaterThan(1);
  });

  it('keeps chunk results in document order despite finishing out of order', async () => {
    const stub = stubReplies([CHUNK_RESPONSE(1), CHUNK_RESPONSE(2), CHUNK_RESPONSE(3), MERGE_RESPONSE]);

    await summarize(longSource, settingsWith({ chunkSize: 500 }), () => {});
    const mergePrompt = stub.prompts[stub.prompts.length - 1];

    // Part 1's facts must precede part 2's in the merged payload.
    expect(mergePrompt.indexOf('Fact from part 1.')).toBeLessThan(
      mergePrompt.indexOf('Fact from part 2.'),
    );
  });
});

describe('summarize — synthesis mode (the fast default)', () => {
  const synthesisSettings = settingsWith({ detail: 'synthesis' });

  it('asks for the synthesis only and skips the JSON records', async () => {
    const stub = stubReplies(['F. New clinical synthesis\nThe synthesis.']);

    const result = await summarize('Short source.', synthesisSettings, () => {});

    expect(stub.callCount()).toBe(1);
    expect(stub.prompts[0]).toContain('Do not write out');
    expect(stub.prompts[0]).toContain('F. New clinical synthesis');
    expect(result.sections.B).toBeUndefined();
    expect(result.sections.F).toBe('The synthesis.');
  });

  it('treats an unlabelled response as the synthesis rather than a parse failure', async () => {
    // Asked for one section, models often just write it without the heading.
    stubReplies(['Partial nephrectomy is preferred for small renal masses.']);

    const result = await summarize('Short source.', synthesisSettings, () => {});

    expect(result.raw).toBeUndefined();
    expect(result.sections.F).toBe('Partial nephrectomy is preferred for small renal masses.');
  });

  it('collects compact facts per chunk, then merges them into a synthesis', async () => {
    const longSource = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'x'.repeat(50)}`).join('\n\n');
    const stub = stubReplies([
      '- [fact] Part one fact.',
      '- [fact] Part two fact.',
      '- [fact] Part three fact.',
      'F. New clinical synthesis\nMerged synthesis.',
    ]);

    const result = await summarize(longSource, settingsWith({ detail: 'synthesis', chunkSize: 500 }), () => {});
    const mergePrompt = stub.prompts[stub.prompts.length - 1];

    expect(stub.prompts[0]).toContain('do not emit JSON');
    expect(mergePrompt).toContain('EXTRACTED FACTS');
    expect(mergePrompt).toContain('Part one fact.');
    expect(result.sections.F).toBe('Merged synthesis.');
    expect(result.sections.B).toBeUndefined();
  });

  it('streams the synthesis so text reaches the caller as it arrives', async () => {
    // Serve a real SSE body so the whole streaming path runs end to end.
    const encoder = new TextEncoder();
    const requestedStream: boolean[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        requestedStream.push(JSON.parse(options.body as string).stream === true);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const piece of ['Partial ', 'nephrectomy ', 'is preferred.']) {
                controller.enqueue(
                  encoder.encode(
                    `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${piece}"}}\n`,
                  ),
                );
              }
              controller.close();
            },
          }),
          { status: 200 },
        );
      }),
    );

    const tokens: string[] = [];
    const result = await summarize('Short source.', synthesisSettings, () => {}, undefined, (t) =>
      tokens.push(t),
    );

    expect(requestedStream[0]).toBe(true);
    // Each report carries the accumulated text so far, not the bare delta.
    expect(tokens).toEqual(['Partial ', 'Partial nephrectomy ', 'Partial nephrectomy is preferred.']);
    expect(result.sections.F).toBe('Partial nephrectomy is preferred.');
  });
});

describe('summarize — failures', () => {
  it('refuses to run without an API key', async () => {
    const settings = settingsWith();
    settings.providers.anthropic.apiKey = '';

    await expect(summarize('text', settings, () => {})).rejects.toThrow(/No API key set for anthropic/);
  });

  it('retries a failed call once before giving up', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        throw new Error('network down');
      }),
    );

    await expect(summarize('text', settingsWith(), () => {})).rejects.toThrow(/failed after a retry/);
    expect(calls).toBe(2);
  });

  it('fails immediately on a bad key instead of waiting out a pointless retry', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }),
        };
      }),
    );

    const started = Date.now();
    await expect(summarize('text', settingsWith(), () => {})).rejects.toThrow(/invalid x-api-key/);

    expect(calls).toBe(1);
    // A 4xx will never succeed on a second attempt, so no 2s backoff is spent.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('still retries a rate limit, which is transient', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++calls === 1) {
          return { ok: false, status: 429, text: async () => '{"error":{"message":"slow down"}}' };
        }
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: FULL_RESPONSE }] }) };
      }),
    );

    const result = await summarize('text', settingsWith(), () => {});

    expect(calls).toBe(2);
    expect(result.sections.F).toContain('Partial nephrectomy');
  });

  it('stops launching chunk calls once one has failed permanently', async () => {
    // Enough paragraphs for well over MAX_CONCURRENT_CHUNKS (4) chunks.
    const longSource = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} ${'x'.repeat(50)}`).join('\n\n');
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++calls === 1) {
          // A 400 is permanent: the run is doomed, so no further chunk should start.
          return { ok: false, status: 400, text: async () => '{"error":{"message":"bad request"}}' };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({ content: [{ type: 'text', text: CHUNK_RESPONSE(calls) }] }),
        };
      }),
    );

    await expect(summarize(longSource, settingsWith({ chunkSize: 500 }), () => {})).rejects.toThrow(/bad request/);

    // The rejection reaches the caller while other chunk calls are still in
    // flight — wait for those to settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Only the calls already in flight when the failure hit; the queue never drains.
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('recovers when the first attempt fails and the retry succeeds', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++calls === 1) throw new Error('transient');
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: FULL_RESPONSE }] }) };
      }),
    );

    const result = await summarize('text', settingsWith(), () => {});

    expect(calls).toBe(2);
    expect(result.sections.F).toContain('Partial nephrectomy');
  });
});
