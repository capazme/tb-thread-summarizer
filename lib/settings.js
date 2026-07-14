export const DEFAULT_SETTINGS = {
  endpointUrl: 'http://localhost:11434',
  model: '',
  maxMessages: 30,
};

export function mergeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function getSettings(storageLocal) {
  const found = await storageLocal.get('settings');
  return mergeSettings(found.settings);
}

export function pickDefaultModel(models) {
  return models.find((m) => m.toLowerCase().startsWith('gemma3')) ?? models[0] ?? '';
}
