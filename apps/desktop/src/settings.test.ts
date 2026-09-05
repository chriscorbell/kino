import { describe, expect, it } from 'vitest';

import { defaultSettings, loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from './settings';

function createStorage(initial?: string) {
  let value = initial ?? null;

  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue;
    },
    value: () => value,
  };
}

describe('settings storage', () => {
  it('uses product defaults when no settings exist', () => {
    const storage = createStorage();

    expect(loadSettings(storage)).toEqual(defaultSettings);
  });

  it('uses product defaults when storage is unavailable', () => {
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('storage unavailable');
        },
      }),
    ).toEqual(defaultSettings);
  });

  it('keeps valid values, repairs invalid values, and ignores retired settings', () => {
    const storage = createStorage(
      JSON.stringify({
        automaticIntroSkipping: true,
        audioOutput: 'surround',
        interfaceScale: 300,
        matchFrameRate: true,
        skipIntroButton: false,
        subtitlePosition: 120,
        subtitleSize: 9000,
        subtitles: 'yes',
      }),
    );

    expect(loadSettings(storage)).toEqual({
      automaticIntroSkipping: true,
      audioOutput: 'auto',
      interfaceScale: 100,
      skipIntroButton: false,
      subtitlePosition: 94,
      subtitleSize: 100,
      subtitles: false,
      upNext: true,
    });
  });

  it('preserves a supported interface scale across reload', () => {
    const storage = createStorage();
    saveSettings(storage, { ...defaultSettings, interfaceScale: 175 });
    expect(loadSettings(storage).interfaceScale).toBe(175);
  });

  it('writes the versioned settings record', () => {
    const storage = createStorage();

    saveSettings(storage, { ...defaultSettings, audioOutput: 'stereo' });

    expect(storage.value()).toBe(JSON.stringify({ ...defaultSettings, audioOutput: 'stereo' }));
    expect(SETTINGS_STORAGE_KEY).toBe('kino.settings.v1');
  });

  it('does not crash when settings cannot be written', () => {
    expect(() =>
      saveSettings(
        {
          setItem: () => {
            throw new Error('storage unavailable');
          },
        },
        defaultSettings,
      ),
    ).not.toThrow();
  });
});
