import type { PlaybackSelection } from './actions';
import { classifySource, sourceKey } from './sources';
import type { CoreTransport } from './transport';
import type { ContinueWatchingItem, MetaDetailsState } from './types';

export interface ResumeRequest {
  checking: boolean;
  item: ContinueWatchingItem;
  transport: CoreTransport | null;
}

// Only a fresh response from the remembered add-on can authorize this shortcut.
// Display labels may change, but the media identity and request headers may not.
export function checkResumeSource(
  item: ContinueWatchingItem,
  state: MetaDetailsState | null,
  loading: boolean,
  error: string | null,
): 'pending' | 'unavailable' | PlaybackSelection {
  const remembered = item.rememberedSource;
  if (!remembered || error) return 'unavailable';
  if (loading || !state || state.metaItem?.content.type === 'Loading') return 'pending';
  const resource = state.metaItem;
  if (resource?.content.type !== 'Ready' || !resource.addon.transportUrl) return 'unavailable';
  const meta = resource.content.content;
  const videoId = item.videoId ?? (item.type === 'series' ? null : item.id);
  const video = meta.videos.find((candidate) => candidate.id === videoId) ?? null;
  if (
    !videoId ||
    meta.id !== item.id ||
    meta.type !== item.type ||
    (item.type === 'series' && !video) ||
    (video?.id ?? meta.id) !== videoId ||
    state.selected?.metaPath.id !== item.id ||
    state.selected.metaPath.type !== item.type ||
    state.selected.streamPath?.id !== videoId ||
    state.selected.streamPath.type !== item.type
  )
    return 'unavailable';

  const support = classifySource(remembered.stream.source);
  if (support !== 'direct' && support !== 'torrent') return 'unavailable';
  const selection = { meta, video };
  const key = sourceKey(remembered.stream, remembered.transportUrl, selection);
  const resources = state.streams.filter(
    (entry) => entry.addon.transportUrl === remembered.transportUrl,
  );
  for (const entry of resources) {
    if (entry.content.type !== 'Ready') continue;
    const stream = entry.content.content.find(
      (candidate) => sourceKey(candidate, remembered.transportUrl, selection) === key,
    );
    if (stream) {
      const index = video ? meta.videos.indexOf(video) : -1;
      return {
        ...selection,
        metaTransportUrl: resource.addon.transportUrl,
        nextVideo: index >= 0 ? (meta.videos[index + 1] ?? null) : null,
        resumeMode: 'resume',
        stream,
        streamTransportUrl: remembered.transportUrl,
      };
    }
  }
  return resources.some((entry) => entry.content.type === 'Loading') ? 'pending' : 'unavailable';
}
