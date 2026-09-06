import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '../../global.css';

import { App } from '../../App';
import { CoreContext } from '../../core/context';
import type { CoreTransport } from '../../core/transport';
import type { CoreRuntimeEvent, MetaDetailsState } from '../../core/types';
import { metaItem, profile } from '../coreState';
import { addon, details, item, remembered } from '../resumeState';

// Compile the production presentation against delayed Core snapshots. A null
// player model holds the player at preparation without contacting a media URL.
const movie = new URLSearchParams(location.search).get('kind') === 'movie';
const saved = movie
  ? { ...item, ...metaItem({ id: 'movie', name: 'Saved movie' }), videoId: 'movie' }
  : item;
const initial = details();
if (movie) {
  initial.metaItem = { addon, content: { type: 'Ready', content: metaItem(saved) } };
  initial.libraryItem = { id: saved.id, videoId: saved.id, timeOffset: 30000 };
  initial.selected = {
    guessStream: false,
    metaPath: { resource: 'meta', type: 'movie', id: saved.id, extra: [] },
    streamPath: { resource: 'stream', type: 'movie', id: saved.id, extra: [] },
  };
}
let state: MetaDetailsState = {
  ...initial,
  streams: [{ addon, content: { type: 'Loading' } }],
};
let playerLoads = 0;
const listeners = new Set<(event: CoreRuntimeEvent) => void>();
const transport: CoreTransport = {
  init: async () => {},
  destroy: async () => {},
  flush: async () => {},
  prepareClose: async () => {},
  onBeforeDestroy: () => () => {},
  dispatch: async (action, model) => {
    if (model === 'player' && action.action === 'Load') playerLoads++;
  },
  getState: (async (model: string) => {
    if (model === 'ctx') return profile();
    if (model === 'continue_watching_preview') return { items: [saved] };
    if (model === 'board') return { catalogs: [] };
    if (model === 'player') return null;
    return state;
  }) as CoreTransport['getState'],
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const root = createRoot(document.getElementById('root')!);
const render = (target = transport) =>
  root.render(
    <CoreContext.Provider
      value={{
        error: null,
        status: 'ready',
        session: 'guest',
        transport: target,
        selectSession: () => {},
      }}
    >
      <App />
    </CoreContext.Provider>,
  );

const probe = {
  get playerLoads() {
    return playerLoads;
  },
  ready(found = true) {
    state = {
      ...initial,
      streams: [
        { addon, content: { type: 'Ready', content: found ? [remembered] : [] } },
        {
          addon: { ...addon, transportUrl: 'https://slow.invalid/manifest.json' },
          content: { type: 'Loading' },
        },
      ],
    };
    listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
  },
  changeProfile() {
    render({ ...transport });
  },
};
declare global {
  interface Window {
    kinoResumeProbe: typeof probe;
  }
}
window.kinoResumeProbe = probe;
render();
