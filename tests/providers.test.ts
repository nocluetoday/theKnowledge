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

const request = { apiKey: 'test-key', model: 'test-model', prompt: 'Extract facts.', maxTokens: 8000 };

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
});

describe('openaiProvider', () => {
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

  it('treats an error body on a 200 response as a failure', async () => {
    mockFetch({ error: { message: 'no credits' } });

    await expect(openrouterProvider.complete(request)).rejects.toThrow(/no credits/);
  });
});
