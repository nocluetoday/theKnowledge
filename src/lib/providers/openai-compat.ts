import type { Effort } from '../settings';
import { readSseStream } from './stream';
import { CompletionRequest, LlmProvider, ProviderError, errorFromResponse, outputLimitError } from './types';

interface OpenAiCompatConfig {
  id: string;
  label: string;
  endpoint: string;
  /**
   * OpenAI's newer models require `max_completion_tokens`; OpenRouter follows
   * the original `max_tokens` field.
   */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  /**
   * How this service spells the reasoning budget. OpenRouter normalizes it into
   * a `reasoning` object across every model it fronts; OpenAI takes a bare
   * `reasoning_effort`.
   */
  effortStyle: 'openrouter' | 'openai';
  extraHeaders?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string };
}

/**
 * OpenAI/OpenRouter stream text as `choices[0].delta.content`. Mid-stream
 * errors and a `length` finish (the output-token cap) throw so a broken or
 * truncated stream is never saved as a complete note.
 */
function makeExtractDelta(label: string) {
  return (payload: unknown): string | undefined => {
    const event = payload as {
      choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
      error?: { message?: string };
    };
    if (event?.error?.message) throw new ProviderError(event.error.message);
    if (event?.choices?.[0]?.finish_reason === 'length') throw outputLimitError(label);
    return event?.choices?.[0]?.delta?.content ?? undefined;
  };
}

/** Build the provider-specific reasoning fields for a request body. */
function effortFields(config: OpenAiCompatConfig, effort: Effort): Record<string, unknown> {
  if (config.effortStyle === 'openai') return { reasoning_effort: effort };
  // `exclude` keeps the reasoning trace out of the response — we never show it,
  // and shipping it back only costs time.
  return { reasoning: { effort, exclude: true } };
}

function createProvider(config: OpenAiCompatConfig): LlmProvider {
  const extractDelta = makeExtractDelta(config.label);

  return {
    id: config.id,

    async complete({
      apiKey,
      model,
      prompt,
      maxTokens,
      effort,
      preferFastestProvider,
      onToken,
      signal,
    }: CompletionRequest): Promise<string> {
      const stream = Boolean(onToken);
      const routeForSpeed = config.effortStyle === 'openrouter' && preferFastestProvider;

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
          ...effortFields(config, effort),
          ...(routeForSpeed ? { provider: { sort: 'throughput' } } : {}),
          ...(stream ? { stream: true } : {}),
        }),
        signal,
      });

      if (!response.ok) throw await errorFromResponse(response, config.label);

      if (stream) {
        const text = await readSseStream(response, extractDelta, onToken);
        if (!text.trim()) throw new ProviderError(`${config.label} returned an empty response.`);
        return text;
      }

      const data = (await response.json()) as ChatCompletionResponse;
      // OpenRouter can return a 200 carrying an error body.
      if (data.error?.message) throw new ProviderError(`${config.label}: ${data.error.message}`);
      if (data.choices?.[0]?.finish_reason === 'length') throw outputLimitError(config.label);

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
  effortStyle: 'openai',
});

export const openrouterProvider = createProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  tokenField: 'max_tokens',
  effortStyle: 'openrouter',
  extraHeaders: {
    'HTTP-Referer': 'https://github.com/nocluetoday/theKnowledge',
    'X-Title': 'Medical Knowledge Clipper',
  },
});
