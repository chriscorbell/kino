import { addonFromManifest } from '../core/adapters';
import type {
  CoreAddon,
  CoreMetaItem,
  CoreMetaPreview,
  CoreSource,
  CoreSourceHints,
  CoreStreamSource,
  CoreVideo,
  ProfileState,
} from '../core/types';

// Builders for the application state the Core adapters produce. Screen tests
// use these so a fake state stays complete without repeating every null field.

export function preview(item: Partial<CoreMetaPreview> & Pick<CoreMetaPreview, 'id'>) {
  return {
    background: null,
    defaultVideoId: null,
    description: null,
    featuredVideoId: null,
    hasScheduledVideos: false,
    inLibrary: false,
    logo: null,
    name: item.id,
    poster: null,
    posterShape: 'poster',
    releaseInfo: null,
    released: null,
    runtime: null,
    type: 'movie',
    watched: false,
    ...item,
  } satisfies CoreMetaPreview;
}

export function metaItem(item: Partial<CoreMetaItem> & Pick<CoreMetaPreview, 'id'>): CoreMetaItem {
  return { ...preview(item), videos: [], ...item };
}

export function video(item: Partial<CoreVideo> & Pick<CoreVideo, 'id'>): CoreVideo {
  return {
    episode: null,
    overview: null,
    released: null,
    season: null,
    thumbnail: null,
    title: item.id,
    watched: false,
    ...item,
  };
}

export function hints(overrides: Partial<CoreSourceHints> = {}): CoreSourceHints {
  return {
    bingeGroup: null,
    countryWhitelist: null,
    filename: null,
    notWebReady: null,
    proxyRequestHeaders: null,
    proxyResponseHeaders: null,
    videoHash: null,
    videoSize: null,
    ...overrides,
  };
}

export function source(
  streamSource: CoreStreamSource,
  overrides: Partial<Omit<CoreSource, 'source'>> = {},
): CoreSource {
  return {
    description: null,
    name: null,
    source: streamSource,
    ...overrides,
    hints: hints(overrides.hints),
  };
}

export function torrentSource(
  torrent: Partial<Extract<CoreStreamSource, { kind: 'torrent' }>> = {},
  overrides: Partial<Omit<CoreSource, 'source'>> = {},
) {
  return source(
    {
      fileIdx: null,
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      kind: 'torrent',
      sources: [],
      ...torrent,
    },
    overrides,
  );
}

export function urlSource(url: string, overrides: Partial<Omit<CoreSource, 'source'>> = {}) {
  return source({ kind: 'url', url }, overrides);
}

export function addon(
  transportUrl: string,
  manifest: Record<string, unknown>,
  overrides: Partial<Pick<CoreAddon, 'flags' | 'transportIssue'>> = {},
): CoreAddon {
  return { ...addonFromManifest(transportUrl, manifest), ...overrides };
}

export function profile(overrides: Partial<ProfileState['profile']> = {}): ProfileState {
  return {
    profile: {
      addons: [],
      auth: null,
      settings: { audioLanguage: null, subtitlesLanguage: null, values: {} },
      ...overrides,
    },
  };
}
