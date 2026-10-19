import {
  type KinoSettings,
  loadSettings,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
} from './settings';

export interface KinoSettingsStore {
  get(): KinoSettings;
  subscribe(listener: () => void): () => void;
  /**
   * Merges the patch into the store's current value, never into a caller's copy, so two writers
   * that read at different times both keep their change. There is deliberately no whole-record
   * setter: spreading a stale snapshot over a newer one is the bug this store exists to remove.
   */
  update(patch: Partial<KinoSettings>): void;
}

export function createKinoSettingsStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): KinoSettingsStore {
  let current = loadSettings(storage);
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      const next = normalizeSettings({ ...current, ...patch });
      const keys = Object.keys(next) as (keyof KinoSettings)[];
      if (keys.every((key) => Object.is(next[key], current[key]))) return;

      current = next;
      try {
        storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Unwritable storage costs persistence across launches, not the change in this session.
      }
      listeners.forEach((listener) => listener());
    },
  };
}
