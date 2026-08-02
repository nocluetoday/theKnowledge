import type { Effort } from '../settings';

export interface CompletionRequest {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  /** Reasoning budget. Each provider names this differently. */
  effort: Effort;
  /** OpenRouter only: prefer the fastest host for the model. */
  preferFastestProvider?: boolean;
  /**
   * When supplied the response is streamed and this is called with the
   * accumulated text so far after each delta. The full text is still returned
   * when the stream completes.
   */
  onToken?: (text: string) => void;
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
 * The model hit the output-token cap mid-response. Saving the truncated text
 * would look like a complete note, so this is treated as a hard failure.
 */
export function outputLimitError(providerLabel: string): ProviderError {
  return new ProviderError(
    `${providerLabel} stopped at the output limit before the response was complete. ` +
      `Raise "Max output tokens" in the extension's settings and try again.`,
  );
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
