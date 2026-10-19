import { createContext, useContext, useSyncExternalStore } from 'react';

import type { KinoSettings } from './settings';
import type { KinoSettingsStore } from './settingsStore';

const KinoSettingsContext = createContext<KinoSettingsStore | null>(null);

export const KinoSettingsProvider = KinoSettingsContext.Provider;

/** The store itself, for code that reads or patches settings outside React's render. */
export function useKinoSettingsStore(): KinoSettingsStore {
  const store = useContext(KinoSettingsContext);
  if (!store) throw new Error('Kino settings need a KinoSettingsProvider above them.');
  return store;
}

export function useKinoSettings(): readonly [KinoSettings, KinoSettingsStore['update']] {
  const store = useKinoSettingsStore();
  return [useSyncExternalStore(store.subscribe, store.get), store.update];
}
