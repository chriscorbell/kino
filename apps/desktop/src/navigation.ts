import { createContext, useCallback, useContext, useState, type SetStateAction } from 'react';

import type { CatalogRequest, LibraryRequest } from './core/types';

export type BrowseScreen = 'home' | 'search' | 'discover' | 'library' | 'addons' | 'settings';

export interface BrowseState {
  search: { query: string; submittedQuery: string };
  discover: CatalogRequest | null;
  library: LibraryRequest | null;
}

export function initialBrowseState(): BrowseState {
  return { search: { query: '', submittedQuery: '' }, discover: null, library: null };
}

export interface NavigationEntry {
  screen: BrowseScreen;
  state: BrowseState;
  scrollTop: number;
  focus: HTMLElement | null;
}

export type UpdateBrowseState = <Key extends keyof BrowseState>(
  key: Key,
  value: SetStateAction<BrowseState[Key]>,
) => void;

export const BrowseStateContext = createContext<{
  state: BrowseState;
  update: UpdateBrowseState;
} | null>(null);

// Standalone screens can still own their state; App stores it in the return entry.
export function useBrowseState<Key extends keyof BrowseState>(key: Key) {
  const context = useContext(BrowseStateContext);
  const [local, setLocal] = useState(() => initialBrowseState()[key]);
  const update = context?.update;
  const setValue = useCallback(
    (value: SetStateAction<BrowseState[Key]>) => {
      if (update) update(key, value);
      else setLocal(value);
    },
    [key, update],
  );
  return [context ? context.state[key] : local, setValue] as const;
}
