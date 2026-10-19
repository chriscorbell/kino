import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { KinoSettings } from '../settings';
import { createKinoSettingsStore, type KinoSettingsStore } from '../settingsStore';
import { KinoSettingsProvider } from '../useKinoSettings';
import { memoryStorage } from './memoryStorage';

/** Renders under a Kino settings store, by default over storage no other test shares. */
export function renderWithSettings(
  ui: ReactElement,
  {
    settings = {},
    storage = memoryStorage(),
    ...options
  }: RenderOptions & {
    settings?: Partial<KinoSettings>;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
  } = {},
): RenderResult & { store: KinoSettingsStore } {
  const store = createKinoSettingsStore(storage);
  store.update(settings);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <KinoSettingsProvider value={store}>{children}</KinoSettingsProvider>
  );
  return { ...render(ui, { ...options, wrapper }), store };
}
