import { createContext, useContext, useSyncExternalStore } from 'react';

import type { KinoSettings } from './settings';
import type { KinoSettingsStore } from './settingsStore';

const KinoSettingsContext = createContext<KinoSettingsStore | null>(null);

export const KinoSettingsProvider = KinoSettingsContext.Provider;

export function useKinoSettings(): readonly [KinoSettings, KinoSettingsStore['update']] {
  const store = useContext(KinoSettingsContext) ?? missingProvider();
  return [useSyncExternalStore(store.subscribe, store.get), store.update];
}

function missingProvider(): never {
  throw new Error('useKinoSettings needs a KinoSettingsProvider above it.');
}
