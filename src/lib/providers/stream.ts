/**
 * Shared Server-Sent Events reader.
 *
 * Anthropic and the OpenAI-compatible providers both stream `data:`-prefixed
 * JSON lines and differ only in the shape of each delta, so the transport and
 * framing live here and each provider supplies its own extractor.
 */

/** Pull the text delta out of one parsed SSE payload, or undefined to skip it. */
export type DeltaExtractor = (payload: unknown) => string | undefined;

/**
 * Consume an SSE response, calling `onToken` with each text delta and resolving
 * with the concatenated text.
 */
export async function readSseStream(
  response: Response,
  extractDelta: DeltaExtractor,
  onToken?: (text: string) => void,
): Promise<string> {
  const body = response.body;
  if (!body) throw new Error('The response contained no body to stream.');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // A network packet can split a line anywhere, so only whole lines are
      // parsed and the remainder is carried into the next read.
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const text = handleLine(line, extractDelta);
        if (text) {
          full += text;
          onToken?.(text);
        }
      }
    }

    // Flush whatever the final packet left behind.
    const tail = handleLine(buffer, extractDelta);
    if (tail) {
      full += tail;
      onToken?.(tail);
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

function handleLine(line: string, extractDelta: DeltaExtractor): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;

  const payload = trimmed.slice(5).trim();
  // OpenAI marks end-of-stream with a sentinel that is not JSON.
  if (!payload || payload === '[DONE]') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A malformed line should not abort a long stream.
    return undefined;
  }

  // Deliberately outside the try: extractors throw to report an error the
  // provider delivered mid-stream, and swallowing that would save an empty note.
  return extractDelta(parsed);
}
