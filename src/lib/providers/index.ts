import { ProviderId } from '../settings';
import { LlmProvider } from './types';
import { anthropicProvider } from './anthropic';
import { openaiProvider, openrouterProvider } from './openai-compat';

const PROVIDERS: Record<ProviderId, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
};

export function getProvider(id: ProviderId): LlmProvider {
  return PROVIDERS[id];
}

export * from './types';
