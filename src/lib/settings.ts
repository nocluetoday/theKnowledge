import { DEFAULT_EXTRACTION_PROMPT } from '../prompts/default-extraction-prompt';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5',
  openrouter: 'anthropic/claude-opus-5',
};

export interface ProviderSettings {
  apiKey: string;
  model: string;
}

export interface Settings {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  subfolder: string;
  chunkSize: number;
  maxOutputTokens: number;
  extractionPrompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  providers: {
    anthropic: { apiKey: '', model: DEFAULT_MODELS.anthropic },
    openai: { apiKey: '', model: DEFAULT_MODELS.openai },
    openrouter: { apiKey: '', model: DEFAULT_MODELS.openrouter },
  },
  subfolder: 'MedKnowledge',
  chunkSize: 100_000,
  maxOutputTokens: 16_000,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
};

const STORAGE_KEY = 'settings';

/** Read settings, filling any unset field from defaults. */
export async function loadSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: {
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...stored.providers?.anthropic },
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...stored.providers?.openai },
      openrouter: { ...DEFAULT_SETTINGS.providers.openrouter, ...stored.providers?.openrouter },
    },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
