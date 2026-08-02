import {
  DEFAULT_SETTINGS,
  PROVIDER_LABELS,
  ProviderId,
  Settings,
  loadSettings,
  saveSettings,
} from '../../src/lib/settings';
import { DEFAULT_EXTRACTION_PROMPT } from '../../src/prompts/default-extraction-prompt';

const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const providerFields = document.getElementById('provider-fields') as HTMLDivElement;
const subfolderInput = document.getElementById('subfolder') as HTMLInputElement;
const askWhereToSaveInput = document.getElementById('ask-where-to-save') as HTMLInputElement;
const chunkSizeInput = document.getElementById('chunk-size') as HTMLInputElement;
const maxTokensInput = document.getElementById('max-tokens') as HTMLInputElement;
const promptTextarea = document.getElementById('prompt') as HTMLTextAreaElement;
const restoreButton = document.getElementById('restore') as HTMLButtonElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openrouter'];

let settings: Settings;

void init();

async function init(): Promise<void> {
  settings = await loadSettings();

  providerSelect.value = settings.provider;
  subfolderInput.value = settings.subfolder;
  askWhereToSaveInput.checked = settings.askWhereToSave;
  chunkSizeInput.value = String(settings.chunkSize);
  maxTokensInput.value = String(settings.maxOutputTokens);
  promptTextarea.value = settings.extractionPrompt;

  renderProviderFields();

  providerSelect.addEventListener('change', () => {
    settings.provider = providerSelect.value as ProviderId;
    clearStatus();
  });
  askWhereToSaveInput.addEventListener('change', clearStatus);
  subfolderInput.addEventListener('input', clearStatus);
  restoreButton.addEventListener('click', () => {
    promptTextarea.value = DEFAULT_EXTRACTION_PROMPT;
    clearStatus();
  });
  saveButton.addEventListener('click', () => void persist());
}

/** One key/model pair per provider, so switching providers keeps both sets. */
function renderProviderFields(): void {
  providerFields.replaceChildren();

  for (const id of PROVIDER_IDS) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = PROVIDER_LABELS[id];
    fieldset.append(legend);

    fieldset.append(
      field(`${id}-key`, 'API key', 'password', settings.providers[id].apiKey),
      field(`${id}-model`, 'Model', 'text', settings.providers[id].model),
    );

    providerFields.append(fieldset);
  }
}

function field(id: string, labelText: string, type: string, value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.value = value;
  input.spellcheck = false;
  input.addEventListener('input', clearStatus);

  fragment.append(label, input);
  return fragment;
}

async function persist(): Promise<void> {
  for (const id of PROVIDER_IDS) {
    const key = (document.getElementById(`${id}-key`) as HTMLInputElement).value.trim();
    const model = (document.getElementById(`${id}-model`) as HTMLInputElement).value.trim();
    settings.providers[id] = {
      apiKey: key,
      model: model || DEFAULT_SETTINGS.providers[id].model,
    };
  }

  settings.provider = providerSelect.value as ProviderId;
  settings.subfolder = subfolderInput.value.trim() || DEFAULT_SETTINGS.subfolder;
  settings.askWhereToSave = askWhereToSaveInput.checked;
  settings.chunkSize = clampNumber(chunkSizeInput.value, 10_000, 1_000_000, DEFAULT_SETTINGS.chunkSize);
  settings.maxOutputTokens = clampNumber(maxTokensInput.value, 1_000, 128_000, DEFAULT_SETTINGS.maxOutputTokens);
  settings.extractionPrompt = promptTextarea.value.trim() || DEFAULT_EXTRACTION_PROMPT;

  await saveSettings(settings);

  chunkSizeInput.value = String(settings.chunkSize);
  maxTokensInput.value = String(settings.maxOutputTokens);
  subfolderInput.value = settings.subfolder;

  statusEl.textContent = 'Saved';
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clearStatus(): void {
  statusEl.textContent = '';
}
