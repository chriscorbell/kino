import type { ContinueWatchingItem, MetaDetailsState } from '../core/types';
import { metaItem, urlSource, video } from './coreState';

export const episode = video({ id: 'show:2:5', title: 'Saved episode', season: 2, episode: 5 });
export const meta = metaItem({
  id: 'show',
  type: 'series',
  name: 'Saved series',
  videos: [video({ id: 'show:1:1', title: 'First episode', season: 1, episode: 1 }), episode],
});
export const addon = {
  manifest: { id: 'test', logo: null, name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};
export const remembered = urlSource('https://media.invalid/saved.mp4', { name: 'Previous source' });
export const item: ContinueWatchingItem = {
  ...meta,
  progress: 25,
  videoId: episode.id,
  rememberedSource: { stream: remembered, transportUrl: addon.transportUrl },
};
export function details(): MetaDetailsState {
  return {
    libraryItem: { id: meta.id, videoId: episode.id, timeOffset: 30000 },
    title: null,
    selected: {
      metaPath: { resource: 'meta', type: 'series', id: meta.id, extra: [] },
      streamPath: { resource: 'stream', type: 'series', id: episode.id, extra: [] },
      guessStream: false,
    },
    metaItem: { addon, content: { type: 'Ready', content: meta } },
    streams: [{ addon, content: { type: 'Ready', content: [remembered] } }],
  };
}
