import type { Effort } from '../settings';
import { readSseStream } from './stream';
import { CompletionRequest, LlmProvider, ProviderError, errorFromResponse, outputLimitError } from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  stop_details?: { category?: string; explanation?: string } | null;
}

/** Anthropic has no `minimal` tier; `low` is its floor. */
function toAnthropicEffort(effort: Effort): string {
  return effort === 'minimal' ? 'low' : effort;
}

/** A refusal or output-limit stop must fail the run, not save a partial note. */
function checkStopReason(stopReason: string | undefined, category?: string): void {
  if (stopReason === 'refusal') {
    throw new ProviderError(
      `Anthropic declined this request${category ? ` (${category})` : ''}. Try a different provider or model.`,
    );
  }
  if (stopReason === 'max_tokens') throw outputLimitError('Anthropic');
}

/**
 * Anthropic streams text as `content_block_delta` events carrying a
 * `text_delta`. `error` events and bad stop reasons (delivered on
 * `message_delta`) throw so a broken stream is never saved as a complete note.
 */
function extractDelta(payload: unknown): string | undefined {
  const event = payload as {
    type?: string;
    delta?: { type?: string; text?: string; stop_reason?: string };
    error?: { message?: string };
  };
  if (event?.type === 'error') {
    throw new ProviderError(event.error?.message ?? 'Anthropic reported an error mid-stream.');
  }
  if (event?.type === 'message_delta') {
    checkStopReason(event.delta?.stop_reason);
    return undefined;
  }
  if (event?.type !== 'content_block_delta') return undefined;
  if (event.delta?.type !== 'text_delta') return undefined;
  return event.delta.text;
}

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',

  async complete({ apiKey, model, prompt, maxTokens, effort, onToken, signal }: CompletionRequest): Promise<string> {
    const stream = Boolean(onToken);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        // Required for requests originating from a browser context.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        output_config: { effort: toAnthropicEffort(effort) },
        messages: [{ role: 'user', content: prompt }],
        ...(stream ? { stream: true } : {}),
      }),
      signal,
    });

    if (!response.ok) throw await errorFromResponse(response, 'Anthropic');

    if (stream) {
      const text = await readSseStream(response, extractDelta, onToken);
      if (!text.trim()) throw new ProviderError('Anthropic returned an empty response.');
      return text;
    }

    const data = (await response.json()) as AnthropicResponse;

    checkStopReason(data.stop_reason, data.stop_details?.category ?? undefined);

    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('');

    if (!text.trim()) throw new ProviderError('Anthropic returned an empty response.');
    return text;
  },
};
