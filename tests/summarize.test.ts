import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarize } from '../src/lib/summarize';
import { DEFAULT_SETTINGS, Settings } from '../src/lib/settings';

function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      anthropic: { apiKey: 'test-key', model: 'claude-opus-5' },
    },
  };
}

/** Stub the Anthropic endpoint, returning each scripted reply in turn. */
function stubReplies(replies: string[]) {
  const prompts: string[] = [];
  let call = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      prompts.push(JSON.parse(options.body as string).messages[0].content);
      const text = replies[Math.min(call++, replies.length - 1)];
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) };
    }),
  );

  return { prompts, callCount: () => call };
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

    expect(updates.some((u) => /part 1 of \d+/.test(u))).toBe(true);
    expect(updates.at(-1)).toMatch(/Merging/);
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
