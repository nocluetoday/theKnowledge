import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/lib/settings';

/** Minimal in-memory stand-in for `browser.storage.local`. */
function fakeStorage() {
  let store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          store = { ...store, ...items };
        },
      },
    },
    reset: () => {
      store = {};
    },
  };
}

const fake = fakeStorage();
vi.stubGlobal('browser', fake);

beforeEach(() => fake.reset());

describe('loadSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    const settings = await loadSettings();

    expect(settings.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(settings.subfolder).toBe('MedKnowledge');
    expect(settings.extractionPrompt).toContain('medical knowledge-extraction system');
  });

  it('defaults to saving without a dialog', async () => {
    expect((await loadSettings()).askWhereToSave).toBe(false);
  });

  it('keeps the save dialog enabled once turned on', async () => {
    await browser.storage.local.set({ settings: { askWhereToSave: true } });

    expect((await loadSettings()).askWhereToSave).toBe(true);
  });

  it('fills unset fields from defaults rather than leaving them undefined', async () => {
    await browser.storage.local.set({ settings: { subfolder: 'Urology' } });

    const settings = await loadSettings();

    expect(settings.subfolder).toBe('Urology');
    expect(settings.chunkSize).toBe(DEFAULT_SETTINGS.chunkSize);
    expect(settings.providers.openai.model).toBe(DEFAULT_SETTINGS.providers.openai.model);
  });

  it('keeps a partially configured provider merged with its defaults', async () => {
    await browser.storage.local.set({
      settings: { providers: { anthropic: { apiKey: 'sk-test' } } },
    });

    const settings = await loadSettings();

    expect(settings.providers.anthropic.apiKey).toBe('sk-test');
    expect(settings.providers.anthropic.model).toBe(DEFAULT_SETTINGS.providers.anthropic.model);
    expect(settings.providers.openrouter.apiKey).toBe('');
  });
});

describe('saveSettings', () => {
  it('round-trips every field', async () => {
    const settings = await loadSettings();
    settings.provider = 'openrouter';
    settings.subfolder = 'Notes/Med';
    settings.chunkSize = 50_000;
    settings.providers.openrouter = { apiKey: 'or-key', model: 'anthropic/claude-opus-5' };

    await saveSettings(settings);

    expect(await loadSettings()).toMatchObject({
      provider: 'openrouter',
      subfolder: 'Notes/Med',
      chunkSize: 50_000,
      providers: expect.objectContaining({
        openrouter: { apiKey: 'or-key', model: 'anthropic/claude-opus-5' },
      }),
    });
  });
});
