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

/**
 * How much of the extraction to actually write out.
 *
 * `synthesis` performs the same staged extraction but emits only the clinical
 * synthesis. The per-claim JSON records are the bulk of the generated text and
 * land in a collapsed block most readers never open, so skipping them is the
 * single largest speed win available.
 */
export type DetailLevel = 'synthesis' | 'full';

/** Reasoning budget. Providers spell this differently; see `src/lib/providers`. */
export type Effort = 'minimal' | 'low' | 'medium' | 'high';

export const EFFORT_LEVELS: Effort[] = ['minimal', 'low', 'medium', 'high'];

export interface Settings {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  subfolder: string;
  /**
   * Open the native Save As dialog for each note instead of saving silently.
   *
   * This is the only way to put a note outside Downloads: `downloads.download`
   * rejects absolute paths, and Firefox does not implement the File System
   * Access API, so a folder cannot be chosen once and remembered. The dialog is
   * pre-filled with the generated path and Firefox reopens it at the last folder
   * used, which gets close to a remembered destination.
   */
  askWhereToSave: boolean;
  detail: DetailLevel;
  effort: Effort;
  /** OpenRouter only: route to the fastest host serving the chosen model. */
  preferFastestProvider: boolean;
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
  askWhereToSave: false,
  detail: 'synthesis',
  effort: 'low',
  preferFastestProvider: true,
  chunkSize: 100_000,
  // On OpenRouter the reasoning effort is a *share* of this number, so keeping
  // it modest bounds reasoning spend as well as output length.
  maxOutputTokens: 8_000,
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
