export interface CompletionRequest {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: string;
  complete(request: CompletionRequest): Promise<string>;
}

/** Error carrying the provider's own message, which the popup surfaces verbatim. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Turn a non-OK fetch Response into a ProviderError, preferring the provider's
 * structured error message over the raw body.
 */
export async function errorFromResponse(response: Response, providerLabel: string): Promise<ProviderError> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message ?? parsed?.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  const suffix = detail ? `: ${detail.slice(0, 500)}` : '';
  return new ProviderError(`${providerLabel} returned ${response.status}${suffix}`, response.status);
}
