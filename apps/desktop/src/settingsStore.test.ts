import { describe, expect, it, vi } from 'vitest';

import { defaultSettings, loadSettings, SETTINGS_STORAGE_KEY } from './settings';
import { createKinoSettingsStore } from './settingsStore';
import { memoryStorage } from './test/memoryStorage';

describe('Kino settings store', () => {
  it('keeps both patches when two writers read at different times', () => {
    const storage = memoryStorage();
    const store = createKinoSettingsStore(storage);
    const playerSnapshot = store.get();

    store.update({ interfaceScale: 150 });
    expect(playerSnapshot.interfaceScale).toBe(100);
    store.update({ volume: 40 });

    expect(store.get()).toMatchObject({ interfaceScale: 150, volume: 40 });
    expect(loadSettings(storage)).toMatchObject({ interfaceScale: 150, volume: 40 });
    expect(createKinoSettingsStore(storage).get()).toEqual(store.get());
  });

  it('handles an invalid value in a patch exactly as loading the same record does', () => {
    const store = createKinoSettingsStore(memoryStorage());
    store.update({ subtitleSize: 150 });
    const record = { ...store.get(), subtitleSize: 9000, volume: -1 };

    store.update({ subtitleSize: 9000, volume: -1 });

    const stored = memoryStorage();
    stored.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(record));
    expect(store.get()).toEqual(loadSettings(stored));
    expect(store.get()).toMatchObject({ subtitleSize: 100, volume: 100 });
  });

  it('notifies on a change and stays quiet on an update that changes nothing', () => {
    const store = createKinoSettingsStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.get();

    store.update({ volume: defaultSettings.volume });
    store.update({});
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(before);

    store.update({ upNext: false });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.update({ upNext: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a second subscription of the same function after the first unsubscribes', () => {
    const store = createKinoSettingsStore(memoryStorage());
    const listener = vi.fn();
    const first = store.subscribe(listener);
    const second = store.subscribe(listener);

    first();
    store.update({ upNext: false });
    expect(listener).toHaveBeenCalledTimes(1);

    second();
    store.update({ upNext: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('writes storage only when a setting changes', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createKinoSettingsStore(storage);

    store.update({});
    store.update({ volume: defaultSettings.volume });
    expect(setItem).not.toHaveBeenCalled();

    store.update({ volume: 40 });
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps and announces the change when storage cannot be written', () => {
    const store = createKinoSettingsStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.update({ audioOutput: 'stereo' })).not.toThrow();
    expect(store.get().audioOutput).toBe('stereo');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves a supported interface scale across reload', () => {
    const storage = memoryStorage();
    createKinoSettingsStore(storage).update({ interfaceScale: 175 });
    expect(loadSettings(storage).interfaceScale).toBe(175);
  });

  it('writes the versioned settings record', () => {
    const storage = memoryStorage();

    createKinoSettingsStore(storage).update({ audioOutput: 'stereo' });

    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ ...defaultSettings, audioOutput: 'stereo' }),
    );
    expect(SETTINGS_STORAGE_KEY).toBe('kino.settings.v1');
  });
});
