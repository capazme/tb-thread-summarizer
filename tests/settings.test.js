import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, getSettings, pickDefaultModel } from '../lib/settings.js';

describe('mergeSettings', () => {
  it('returns defaults for empty/undefined stored values', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('stored values override defaults', () => {
    expect(mergeSettings({ model: 'velvet:2b' }).model).toBe('velvet:2b');
    expect(mergeSettings({ model: 'velvet:2b' }).maxMessages).toBe(30);
  });
});

describe('getSettings', () => {
  it('reads the "settings" key from storage.local', async () => {
    const fake = { async get(key) { return key === 'settings' ? { settings: { maxMessages: 10 } } : {}; } };
    expect((await getSettings(fake)).maxMessages).toBe(10);
    expect((await getSettings(fake)).endpointUrl).toBe('http://localhost:11434');
  });
});

describe('pickDefaultModel', () => {
  it('prefers the first gemma3* model', () => {
    expect(pickDefaultModel(['velvet:2b', 'gemma3:latest'])).toBe('gemma3:latest');
  });
  it('falls back to the first model, then to empty string', () => {
    expect(pickDefaultModel(['velvet:2b'])).toBe('velvet:2b');
    expect(pickDefaultModel([])).toBe('');
  });
});
