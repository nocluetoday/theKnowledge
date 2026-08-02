import { describe, expect, it, vi } from 'vitest';
import { readSseStream } from '../src/lib/providers/stream';
import { ProviderError } from '../src/lib/providers/types';

/** Build a Response whose body streams the given string pieces verbatim. */
function sseResponse(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body);
}

const anthropicDelta = (payload: unknown): string | undefined => {
  const event = payload as { type?: string; delta?: { type?: string; text?: string } };
  if (event?.type !== 'content_block_delta') return undefined;
  if (event.delta?.type !== 'text_delta') return undefined;
  return event.delta.text;
};

const openaiDelta = (payload: unknown): string | undefined => {
  const event = payload as {
    choices?: Array<{ delta?: { content?: string | null } }>;
    error?: { message?: string };
  };
  if (event?.error?.message) throw new ProviderError(event.error.message);
  return event?.choices?.[0]?.delta?.content ?? undefined;
};

describe('readSseStream — OpenAI/OpenRouter shape', () => {
  it('reports the accumulated text so far with each delta', async () => {
    // Cumulative rather than per-delta: a consumer that shows the text can then
    // simply replace what it has, and a retried stream cannot double up.
    const response = sseResponse([
      'data: {"choices":[{"delta":{"content":"Partial "}}]}\n',
      'data: {"choices":[{"delta":{"content":"nephrectomy"}}]}\n',
      'data: [DONE]\n',
    ]);
    const tokens: string[] = [];

    const text = await readSseStream(response, openaiDelta, (t) => tokens.push(t));

    expect(text).toBe('Partial nephrectomy');
    expect(tokens).toEqual(['Partial ', 'Partial nephrectomy']);
  });

  it('handles a line split across packet boundaries', async () => {
    // A network packet can cut a JSON line anywhere; the parser must buffer.
    const response = sseResponse([
      'data: {"choices":[{"delta":{"con',
      'tent":"split across packets"}}]}\n',
      'data: [DONE]\n',
    ]);

    await expect(readSseStream(response, openaiDelta)).resolves.toBe('split across packets');
  });

  it('emits the final line when the stream ends without a trailing newline', async () => {
    const response = sseResponse(['data: {"choices":[{"delta":{"content":"no newline"}}]}']);

    await expect(readSseStream(response, openaiDelta)).resolves.toBe('no newline');
  });

  it('ignores keep-alive comments, blank lines, and the done sentinel', async () => {
    const response = sseResponse([
      ': keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"kept"}}]}\n',
      '\n',
      'data: [DONE]\n',
    ]);

    await expect(readSseStream(response, openaiDelta)).resolves.toBe('kept');
  });

  it('skips a malformed line rather than aborting a long stream', async () => {
    const response = sseResponse([
      'data: {"choices":[{"delta":{"content":"before "}}]}\n',
      'data: {not json\n',
      'data: {"choices":[{"delta":{"content":"after"}}]}\n',
    ]);

    await expect(readSseStream(response, openaiDelta)).resolves.toBe('before after');
  });

  it('surfaces an error delivered mid-stream', async () => {
    const response = sseResponse(['data: {"error":{"message":"rate limited"}}\n']);

    await expect(readSseStream(response, openaiDelta)).rejects.toThrow(/rate limited/);
  });
});

describe('readSseStream — Anthropic shape', () => {
  it('reads text_delta events and ignores the surrounding lifecycle events', async () => {
    const response = sseResponse([
      'event: message_start\ndata: {"type":"message_start"}\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"T1a "}}\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tumors"}}\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n',
    ]);
    const onToken = vi.fn();

    const text = await readSseStream(response, anthropicDelta, onToken);

    expect(text).toBe('T1a tumors');
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenLastCalledWith('T1a tumors');
  });

  it('ignores thinking deltas, which are not part of the answer', async () => {
    const response = sseResponse([
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}\n',
    ]);

    await expect(readSseStream(response, anthropicDelta)).resolves.toBe('answer');
  });
});

describe('readSseStream — failures', () => {
  it('rejects when the response has no body', async () => {
    await expect(readSseStream({ body: null } as Response, openaiDelta)).rejects.toThrow(/no body/);
  });
});
