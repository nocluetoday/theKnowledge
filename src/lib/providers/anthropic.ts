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

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',

  async complete({ apiKey, model, prompt, maxTokens, signal }: CompletionRequest): Promise<string> {
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
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });

    if (!response.ok) throw await errorFromResponse(response, 'Anthropic');

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
