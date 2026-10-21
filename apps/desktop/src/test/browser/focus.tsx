import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '../../global.css';
import { App } from '../../App';
import { logoutAction } from '../../core/actions';
import { CoreContext } from '../../core/context';
import type { CoreTransport } from '../../core/transport';
import type { CoreSession } from '../../core/storage';
import type {
  CatalogRequest,
  CatalogWithFiltersState,
  CoreRuntimeEvent,
  ProfileState,
} from '../../core/types';
import { createKinoSettingsStore } from '../../settingsStore';
import { KinoSettingsProvider } from '../../useKinoSettings';
import { profile } from '../coreState';

// A signed-in account with a Discover catalog that offers genres, so the probe can
// reach the genre selector and every account action through the production App.
const genres = [null, 'Action', 'Drama', 'Comedy'];
const request = (genre: string | null): CatalogRequest => ({
  base: 'https://catalog.invalid/manifest.json',
  path: {
    resource: 'catalog',
    type: 'movie',
    id: 'top',
    extra: genre ? [['genre', genre]] : [],
  },
});
let genre: string | null = null;
const genreLoads: Array<string | null> = [];
let account: ProfileState = profile({
  auth: { user: { email: 'viewer@example.invalid', name: null } },
});
let session: CoreSession = 'account';
const listeners = new Set<(event: CoreRuntimeEvent) => void>();

const discover = (): CatalogWithFiltersState => ({
  selected: { request: request(genre) },
  catalog: { content: { type: 'Ready', content: [] } },
  selectable: {
    nextPage: false,
    types: [{ type: 'movie', selected: true, request: request(null) }],
    catalogs: [
      {
        addon: { manifest: { id: 'fixture', name: 'Fixture' } },
        id: 'top',
        name: 'Top',
        request: request(genre),
        selected: true,
      },
    ],
    extra: [
      {
        name: 'genre',
        isRequired: false,
        options: genres.map((value) => ({
          value,
          selected: value === genre,
          request: request(value),
        })),
      },
    ],
  },
});

const transport: CoreTransport = {
  init: async () => {},
  destroy: async () => {},
  prepareClose: async () => {},
  onBeforeDestroy: () => () => {},
  commit: async (action) => {
    if (action !== logoutAction) return;
    account = profile();
    listeners.forEach((listener) => listener({ name: 'NewState', args: ['ctx'] }));
  },
  dispatch: async (action, model) => {
    if (model !== 'discover' || action.action !== 'Load') return;
    const selected = (action.args as { args: { request: CatalogRequest } | null }).args;
    genre = selected?.request.path.extra.find(([name]) => name === 'genre')?.[1] ?? null;
    genreLoads.push(genre);
  },
  getState: (async (model: string) => {
    if (model === 'ctx') return account;
    if (model === 'continue_watching_preview') return { items: [] };
    if (model === 'board') return { selected: null, catalogs: [] };
    if (model === 'discover') return discover();
    return null;
  }) as CoreTransport['getState'],
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const root = createRoot(document.getElementById('root')!);
const settings = createKinoSettingsStore(window.localStorage);
const render = () =>
  root.render(
    <CoreContext.Provider
      value={{
        transport,
        session,
        status: 'ready',
        error: null,
        selectSession: (next) => {
          session = next;
          render();
        },
      }}
    >
      <KinoSettingsProvider value={settings}>
        <App />
      </KinoSettingsProvider>
    </CoreContext.Provider>,
  );
const probe = { genreLoads };
declare global {
  interface Window {
    kinoFocusProbe: typeof probe;
  }
}
window.kinoFocusProbe = probe;
render();
