import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '../../global.css';
import { App } from '../../App';
import { CoreContext } from '../../core/context';
import type { CoreTransport } from '../../core/transport';
import type { CoreRuntimeEvent, MetaDetailsState } from '../../core/types';
import type { CoreSession } from '../../core/storage';
import { metaItem, profile, video, urlSource } from '../coreState';
import { addon } from '../resumeState';

const videos = [0, 1, 2, 4].flatMap((season) =>
  Array.from({ length: 24 }, (_, index) =>
    video({
      id: `show:${season}:${index + 1}`,
      season,
      episode: index + 1,
      title: `Episode ${index + 1}: A long episode title that stays readable when the window is narrow`,
    }),
  ),
);
let meta = metaItem({ id: 'show', type: 'series', name: 'Season fixture', videos });
let state: MetaDetailsState = {
  title: null,
  selected: null,
  streams: [],
  libraryItem: { id: 'show', videoId: 'show:2:1', timeOffset: 20000 },
  metaItem: { addon, content: { type: 'Ready', content: meta } },
};
let selected: MetaDetailsState['selected'] = null;
let session: CoreSession = 'guest';
let playerLoads = 0;
const requests: string[] = [];
const listeners = new Set<(event: CoreRuntimeEvent) => void>();
const emit = () =>
  listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
const transport: CoreTransport = {
  init: async () => {},
  destroy: async () => {},
  flush: async () => {},
  prepareClose: async () => {},
  onBeforeDestroy: () => () => {},
  dispatch: async (action, model) => {
    if (model === 'player' && action.action === 'Load') playerLoads++;
    if (model !== 'meta_details' || action.action !== 'Load') return;
    selected = (action.args as { args: MetaDetailsState['selected'] }).args;
    const id = selected?.streamPath?.id;
    if (id) requests.push(id);
    state = {
      ...state,
      selected,
      metaItem: { addon, content: { type: 'Ready', content: meta } },
      streams: id ? [{ addon, content: { type: 'Loading' } }] : [],
    };
  },
  getState: (async (model: string) => {
    if (model === 'ctx') return profile();
    if (model === 'continue_watching_preview') return { items: [] };
    if (model === 'board')
      return {
        selected: null,
        catalogs: [
          {
            addon,
            id: 'fixture',
            name: 'Fixture',
            type: 'series',
            content: { type: 'Ready', content: [meta] },
          },
        ],
      };
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
        transport: target,
        session,
        status: 'ready',
        error: null,
        selectSession: () => {},
      }}
    >
      <App />
    </CoreContext.Provider>,
  );
const probe = {
  get requests() {
    return requests;
  },
  get playerLoads() {
    return playerLoads;
  },
  ready(id = selected?.streamPath?.id) {
    state = {
      ...state,
      selected: selected && { ...selected, streamPath: { ...selected.streamPath!, id: id! } },
      streams: [
        {
          addon,
          content: {
            type: 'Ready',
            content: [urlSource('https://media.invalid/fixture.mp4', { name: `Source for ${id}` })],
          },
        },
      ],
    };
    emit();
  },
  fail() {
    state = {
      ...state,
      selected,
      streams: [
        {
          addon,
          content: { type: 'Err', content: { kind: 'other', message: 'Synthetic failure' } },
        },
      ],
    };
    emit();
  },
  lateProgress() {
    meta = {
      ...meta,
      videos: videos.map((item) => ({ ...item, watched: item.id === 'show:2:24' })),
    };
    state = {
      ...state,
      libraryItem: { id: 'show', videoId: 'show:2:24', timeOffset: 90000 },
      metaItem: { addon, content: { type: 'Ready', content: meta } },
    };
    emit();
  },
  changeProfile() {
    session = 'account';
    meta = { ...meta, videos };
    state = {
      ...state,
      selected: null,
      libraryItem: null,
      streams: [],
      metaItem: { addon, content: { type: 'Ready', content: meta } },
    };
    render({ ...transport });
  },
};
declare global {
  interface Window {
    kinoSeasonsProbe: typeof probe;
  }
}
window.kinoSeasonsProbe = probe;
render();
