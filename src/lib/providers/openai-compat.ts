import { CompletionRequest, LlmProvider, ProviderError, errorFromResponse } from './types';

interface OpenAiCompatConfig {
  id: string;
  label: string;
  endpoint: string;
  /**
   * OpenAI's newer models require `max_completion_tokens`; OpenRouter follows
   * the original `max_tokens` field.
   */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  extraHeaders?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

function createProvider(config: OpenAiCompatConfig): LlmProvider {
  return {
    id: config.id,

    async complete({ apiKey, model, prompt, maxTokens, signal }: CompletionRequest): Promise<string> {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...config.extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          [config.tokenField]: maxTokens,
        }),
        signal,
      });

      if (!response.ok) throw await errorFromResponse(response, config.label);

      const data = (await response.json()) as ChatCompletionResponse;
      // OpenRouter can return a 200 carrying an error body.
      if (data.error?.message) throw new ProviderError(`${config.label}: ${data.error.message}`);

      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) throw new ProviderError(`${config.label} returned an empty response.`);
      return text;
    },
  };
}

export const openaiProvider = createProvider({
  id: 'openai',
  label: 'OpenAI',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  tokenField: 'max_completion_tokens',
});

export const openrouterProvider = createProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  tokenField: 'max_tokens',
  extraHeaders: {
    'HTTP-Referer': 'https://github.com/donneff/med-knowledge-clipper',
    'X-Title': 'Medical Knowledge Clipper',
  },
});
