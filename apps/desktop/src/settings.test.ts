import { type SettingSpec, settingsSchema } from '@kino/settings';
import { describe, expect, it, vi } from 'vitest';

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

const load = (values: object) => loadSettings(createStorage(JSON.stringify(values)));

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
        matchRefreshRate: true,
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
      matchRefreshRate: true,
      skipIntroButton: false,
      subtitlePosition: 94,
      subtitleSize: 100,
      subtitles: false,
      upNext: true,
      volume: 100,
    });
  });

  it('preserves a supported interface scale across reload', () => {
    const storage = createStorage();
    saveSettings(storage, { ...defaultSettings, interfaceScale: 175 });
    expect(loadSettings(storage).interfaceScale).toBe(175);
  });

  it('restores saved volume and rejects invalid levels', () => {
    expect(loadSettings(createStorage('{"volume":37}')).volume).toBe(37);
    for (const volume of [-1, 101, 'quiet', null]) {
      expect(loadSettings(createStorage(JSON.stringify({ volume }))).volume).toBe(100);
    }
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

  it('keeps a ranged value at either limit and repairs one past it or of another type', () => {
    expect(load({ subtitlePosition: 50, subtitleSize: 200, volume: 0 })).toMatchObject({
      subtitlePosition: 50,
      subtitleSize: 200,
      volume: 0,
    });
    expect(load({ subtitlePosition: 94.5, subtitleSize: 49, volume: '50' })).toMatchObject({
      subtitlePosition: 94,
      subtitleSize: 100,
      volume: 100,
    });
  });

  it('keeps only listed choices and real booleans', () => {
    expect(load({ audioOutput: 'stereo', interfaceScale: 125, upNext: false })).toMatchObject({
      audioOutput: 'stereo',
      interfaceScale: 125,
      upNext: false,
    });
    expect(
      load({ audioOutput: 'Stereo', interfaceScale: '125', skipIntroButton: 'false', upNext: 0 }),
    ).toMatchObject({
      audioOutput: 'auto',
      interfaceScale: 100,
      skipIntroButton: true,
      upNext: true,
    });
  });

  it('reads subtitle size and position on the desktop scale, not the TV one', () => {
    expect(load({ subtitlePosition: 16 }).subtitlePosition).toBe(94);
  });

  it('stores no setting that only the TV lists', async () => {
    vi.resetModules();
    vi.doMock('@kino/settings', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@kino/settings')>();
      const tvOnly: SettingSpec = {
        value: { kind: 'boolean', default: true },
        platforms: { tv: { key: 'tv_only' } },
      };
      return { ...actual, settingsSchema: { ...actual.settingsSchema, tvOnly } };
    });
    try {
      const desktop = await import('./settings');

      expect(desktop.defaultSettings).not.toHaveProperty('tvOnly');
      expect(desktop.loadSettings(createStorage('{"tvOnly":false}'))).not.toHaveProperty('tvOnly');
      expect(desktop.defaultSettings).toEqual(defaultSettings);
    } finally {
      vi.doUnmock('@kino/settings');
      vi.resetModules();
    }
  });
});

describe('settings schema', () => {
  it('lists every setting on a platform, with a default its own domain accepts', () => {
    for (const [name, spec] of Object.entries(settingsSchema) as [string, SettingSpec][]) {
      expect(Object.keys(spec.platforms), name).not.toEqual([]);
      for (const value of [spec.value, spec.platforms.tv?.value]) {
        if (value?.kind === 'choice') expect(value.values, name).toContain(value.default);
        if (value?.kind === 'range') {
          expect(value.default, name).toBeGreaterThanOrEqual(value.min);
          expect(value.default, name).toBeLessThanOrEqual(value.max);
        }
      }
    }
  });
});
