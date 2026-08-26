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

  it('keeps valid values and repairs invalid values', () => {
    const storage = createStorage(
      JSON.stringify({
        automaticIntroSkipping: true,
        audioOutput: 'surround',
        matchFrameRate: true,
        skipIntroButton: false,
        subtitlePosition: 90,
        subtitleSize: 9000,
        subtitles: 'yes',
      }),
    );

    expect(loadSettings(storage)).toEqual({
      automaticIntroSkipping: true,
      audioOutput: 'auto',
      matchFrameRate: true,
      skipIntroButton: false,
      subtitlePosition: 90,
      subtitleSize: 100,
      subtitles: false,
      upNext: true,
    });
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
