import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicProvider } from '../src/lib/providers/anthropic';
import { openaiProvider, openrouterProvider } from '../src/lib/providers/openai-compat';
import { ProviderError } from '../src/lib/providers/types';

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const spy = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function lastRequest(spy: ReturnType<typeof vi.fn>) {
  const [url, options] = spy.mock.calls[0];
  return { url: url as string, options: options as RequestInit, body: JSON.parse(options.body as string) };
}

/** Stub fetch with a streaming SSE response built from the given lines. */
function mockSseFetch(pieces: string[]) {
  const encoder = new TextEncoder();
  const spy = vi.fn().mockImplementation(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const piece of pieces) controller.enqueue(encoder.encode(piece));
            controller.close();
          },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const request = {
  apiKey: 'test-key',
  model: 'test-model',
  prompt: 'Extract facts.',
  maxTokens: 8000,
  effort: 'low' as const,
};

afterEach(() => vi.unstubAllGlobals());

describe('anthropicProvider', () => {
  it('posts to the messages endpoint with the version and browser-access headers', async () => {
    const spy = mockFetch({ content: [{ type: 'text', text: 'A. Source' }] });
    await anthropicProvider.complete(request);

    const { url, options, body } = lastRequest(spy);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((options.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    expect((options.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((options.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(body.max_tokens).toBe(8000);
    expect(body.messages).toEqual([{ role: 'user', content: 'Extract facts.' }]);
  });

  it('concatenates text blocks and ignores non-text blocks', async () => {
    mockFetch({
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'part one ' },
        { type: 'text', text: 'part two' },
      ],
    });

    await expect(anthropicProvider.complete(request)).resolves.toBe('part one part two');
  });

  it('reports a refusal as an actionable error', async () => {
    mockFetch({ content: [], stop_reason: 'refusal', stop_details: { category: 'bio' } });

    await expect(anthropicProvider.complete(request)).rejects.toThrow(/declined this request \(bio\)/);
  });

  it('surfaces the provider error message on a non-OK response', async () => {
    mockFetch({ error: { message: 'invalid x-api-key' } }, { ok: false, status: 401 });

    await expect(anthropicProvider.complete(request)).rejects.toThrow(/401.*invalid x-api-key/);
  });

  it('rejects an empty response rather than saving a blank note', async () => {
    mockFetch({ content: [{ type: 'text', text: '   ' }] });

    await expect(anthropicProvider.complete(request)).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a response truncated at the output limit instead of saving it', async () => {
    mockFetch({ content: [{ type: 'text', text: 'truncated mid-sent' }], stop_reason: 'max_tokens' });

    await expect(anthropicProvider.complete(request)).rejects.toThrow(/output limit.*Max output tokens/s);
  });

  it('surfaces an error event delivered mid-stream instead of saving a partial note', async () => {
    mockSseFetch([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial "}}\n',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n',
    ]);

    await expect(anthropicProvider.complete({ ...request, onToken: () => {} })).rejects.toThrow(/Overloaded/);
  });

  it('rejects a streamed response that stopped at the output limit', async () => {
    mockSseFetch([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial "}}\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n',
      'data: {"type":"message_stop"}\n',
    ]);

    await expect(anthropicProvider.complete({ ...request, onToken: () => {} })).rejects.toThrow(
      /output limit.*Max output tokens/s,
    );
  });

  it('reports a refusal delivered mid-stream as an actionable error', async () => {
    mockSseFetch([
      'data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n',
      'data: {"type":"message_stop"}\n',
    ]);

    await expect(anthropicProvider.complete({ ...request, onToken: () => {} })).rejects.toThrow(
      /declined this request/,
    );
  });

  it('sends effort inside output_config', async () => {
    const spy = mockFetch({ content: [{ type: 'text', text: 'ok' }] });
    await anthropicProvider.complete({ ...request, effort: 'medium' });

    expect(lastRequest(spy).body.output_config).toEqual({ effort: 'medium' });
  });

  it('maps minimal to low, which Anthropic does not accept', async () => {
    const spy = mockFetch({ content: [{ type: 'text', text: 'ok' }] });
    await anthropicProvider.complete({ ...request, effort: 'minimal' });

    expect(lastRequest(spy).body.output_config).toEqual({ effort: 'low' });
  });
});

describe('openaiProvider effort', () => {
  it('sends a bare reasoning_effort rather than an object', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openaiProvider.complete({ ...request, effort: 'minimal' });

    const { body } = lastRequest(spy);
    expect(body.reasoning_effort).toBe('minimal');
    expect(body.reasoning).toBeUndefined();
  });

  it('never asks for provider routing, which is OpenRouter-only', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openaiProvider.complete({ ...request, preferFastestProvider: true });

    expect(lastRequest(spy).body.provider).toBeUndefined();
  });
});

describe('openaiProvider', () => {
  it('rejects a response truncated at the output limit instead of saving it', async () => {
    mockFetch({ choices: [{ message: { content: 'truncated mid-sent' }, finish_reason: 'length' }] });

    await expect(openaiProvider.complete(request)).rejects.toThrow(/output limit.*Max output tokens/s);
  });

  it('rejects a streamed response that stopped at the output limit', async () => {
    mockSseFetch([
      'data: {"choices":[{"delta":{"content":"partial "}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
      'data: [DONE]\n',
    ]);

    await expect(openaiProvider.complete({ ...request, onToken: () => {} })).rejects.toThrow(
      /output limit.*Max output tokens/s,
    );
  });

  it('uses max_completion_tokens and a bearer token', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openaiProvider.complete(request);

    const { url, options, body } = lastRequest(spy);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((options.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(body.max_completion_tokens).toBe(8000);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('openrouterProvider', () => {
  it('uses max_tokens and sends attribution headers', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openrouterProvider.complete(request);

    const { url, options, body } = lastRequest(spy);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((options.headers as Record<string, string>)['X-Title']).toBe('Medical Knowledge Clipper');
    expect(body.max_tokens).toBe(8000);
  });

  it('sends effort as a reasoning object with the trace excluded', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openrouterProvider.complete({ ...request, effort: 'minimal' });

    // OpenRouter normalizes reasoning across every model it fronts, so the
    // object form is what reaches GPT-, Claude-, and Gemini-family models alike.
    expect(lastRequest(spy).body.reasoning).toEqual({ effort: 'minimal', exclude: true });
  });

  it('asks for the fastest host only when the setting is on', async () => {
    const on = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openrouterProvider.complete({ ...request, preferFastestProvider: true });
    expect(lastRequest(on).body.provider).toEqual({ sort: 'throughput' });

    vi.unstubAllGlobals();
    const off = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await openrouterProvider.complete({ ...request, preferFastestProvider: false });
    expect(lastRequest(off).body.provider).toBeUndefined();
  });

  it('treats an error body on a 200 response as a failure', async () => {
    mockFetch({ error: { message: 'no credits' } });

    await expect(openrouterProvider.complete(request)).rejects.toThrow(/no credits/);
  });
});
