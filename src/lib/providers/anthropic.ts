import type { Effort } from '../settings';
import { readSseStream } from './stream';
import { CompletionRequest, LlmProvider, ProviderError, errorFromResponse } from './types';

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

/** Anthropic streams text as `content_block_delta` events carrying a `text_delta`. */
function extractDelta(payload: unknown): string | undefined {
  const event = payload as { type?: string; delta?: { type?: string; text?: string } };
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

    if (data.stop_reason === 'refusal') {
      const category = data.stop_details?.category;
      throw new ProviderError(
        `Anthropic declined this request${category ? ` (${category})` : ''}. Try a different provider or model.`,
      );
    }

    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('');

    if (!text.trim()) throw new ProviderError('Anthropic returned an empty response.');
    return text;
  },
};
