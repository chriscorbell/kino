import type {
  CatalogRequest,
  CoreAction,
  CoreAddon,
  CoreMetaPreview,
  CoreProfileSettings,
  CoreSource,
  CoreSourceHints,
  CoreVideo,
  LibraryRequest,
} from './types';

export interface PlaybackSelection {
  meta: CoreMetaPreview;
  metaTransportUrl: string;
  nextVideo: CoreVideo | null;
  stream: CoreSource;
  streamTransportUrl: string;
  video: CoreVideo | null;
}

export const loadBoardAction: CoreAction = {
  action: 'Load',
  args: { model: 'CatalogsWithExtra', args: { extra: [] } },
};

export function loadSearchAction(query: string): CoreAction {
  return {
    action: 'Load',
    args: {
      model: 'CatalogsWithExtra',
      args: { extra: [['search', query]] },
    },
  };
}

export function loadCatalogAction(request: CatalogRequest | null): CoreAction {
  return {
    action: 'Load',
    args: { model: 'CatalogWithFilters', args: request ? { request } : null },
  };
}

export function loadLibraryAction(request: LibraryRequest | null): CoreAction {
  return {
    action: 'Load',
    args: {
      model: 'LibraryWithFilters',
      args: { request: request ?? { page: 1, sort: 'lastwatched', type: null } },
    },
  };
}

export function loadMetaDetailsAction(meta: CoreMetaPreview, videoId: string | null): CoreAction {
  return {
    action: 'Load',
    args: {
      model: 'MetaDetails',
      args: {
        metaPath: { resource: 'meta', type: meta.type, id: meta.id, extra: [] },
        streamPath: videoId
          ? { resource: 'stream', type: meta.type, id: videoId, extra: [] }
          : null,
        guessStream: meta.type !== 'series',
      },
    },
  };
}

function present<Value>(name: string, value: Value | null) {
  return value === null ? {} : { [name]: value };
}

function hintsPayload(hints: CoreSourceHints) {
  const proxyHeaders = {
    ...present('request', hints.proxyRequestHeaders),
    ...present('response', hints.proxyResponseHeaders),
  };
  const payload = {
    ...present('bingeGroup', hints.bingeGroup),
    ...present('countryWhitelist', hints.countryWhitelist),
    ...present('filename', hints.filename),
    ...present('notWebReady', hints.notWebReady),
    ...(Object.keys(proxyHeaders).length > 0 ? { proxyHeaders } : {}),
    ...present('videoHash', hints.videoHash),
    ...present('videoSize', hints.videoSize),
  };
  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * Serialize a chosen source back into the Stream shape Core deserializes.
 * Application-only data stays out, exactly one source variant is written, and
 * torrent discovery hints go back as `announce`, which is the field pinned Core
 * 0.61.0 emits and accepts. Proxy headers, file hints, and the file index have
 * to survive: Core builds the streaming-server URL and the subtitle request
 * from them.
 */
export function playerStreamPayload(source: CoreSource) {
  const identity = (() => {
    switch (source.source.kind) {
      case 'torrent':
        return {
          infoHash: source.source.infoHash,
          ...present('fileIdx', source.source.fileIdx),
          ...(source.source.sources.length > 0 ? { announce: source.source.sources } : {}),
        };
      case 'external':
        return { externalUrl: source.source.externalUrl };
      case 'playerFrame':
        return { playerFrameUrl: source.source.playerFrameUrl };
      case 'url':
        return { url: source.source.url };
      case 'youtube':
        return { ytId: source.source.ytId };
    }
  })();
  return {
    ...identity,
    ...present('name', source.name),
    ...present('description', source.description),
    ...present('behaviorHints', hintsPayload(source.hints)),
  };
}

export function loadPlayerAction(selection: PlaybackSelection): CoreAction {
  const videoId = selection.video?.id ?? selection.meta.id;
  return {
    action: 'Load',
    args: {
      model: 'Player',
      args: {
        stream: playerStreamPayload(selection.stream),
        streamRequest: {
          base: selection.streamTransportUrl,
          path: {
            resource: 'stream',
            type: selection.meta.type,
            id: videoId,
            extra: [],
          },
        },
        metaRequest: {
          base: selection.metaTransportUrl,
          path: {
            resource: 'meta',
            type: selection.meta.type,
            id: selection.meta.id,
            extra: [],
          },
        },
        subtitlesPath: {
          resource: 'subtitles',
          type: selection.meta.type,
          id: videoId,
          extra: [],
        },
      },
    },
  };
}

export function updateProfileSettingsAction(
  settings: CoreProfileSettings,
  patch: Record<string, unknown>,
): CoreAction {
  // Core replaces the whole settings record, so the unread values go back too.
  return {
    action: 'Ctx',
    args: { action: 'UpdateSettings', args: { ...settings.values, ...patch } },
  };
}

function addonPayload(addon: CoreAddon) {
  return {
    flags: { official: addon.flags.official, protected: addon.flags.protected },
    manifest: addon.manifest.values,
    transportUrl: addon.transportUrl,
  };
}

export function installAddonAction(addon: CoreAddon): CoreAction {
  return { action: 'Ctx', args: { action: 'InstallAddon', args: addonPayload(addon) } };
}

export function uninstallAddonAction(addon: CoreAddon): CoreAction {
  return { action: 'Ctx', args: { action: 'UninstallAddon', args: addonPayload(addon) } };
}

export function addToLibraryAction(meta: CoreMetaPreview): CoreAction {
  return {
    action: 'Ctx',
    args: {
      action: 'AddToLibrary',
      args: {
        id: meta.id,
        type: meta.type,
        name: meta.name,
        ...present('poster', meta.poster),
        // Pinned Core 0.61.0 reads "poster" and "square" but maps "landscape"
        // onto Square. Kino sends the shape it holds; nothing it renders
        // depends on the value.
        posterShape: meta.posterShape,
        ...present('background', meta.background),
        ...present('logo', meta.logo),
        ...present('description', meta.description),
        ...present('releaseInfo', meta.releaseInfo),
        ...present('released', meta.released),
        ...present('runtime', meta.runtime),
        links: [],
        behaviorHints: {
          ...present('defaultVideoId', meta.defaultVideoId),
          ...present('featuredVideoId', meta.featuredVideoId),
          hasScheduledVideos: meta.hasScheduledVideos,
        },
      },
    },
  };
}

export function rewindLibraryItemAction(id: string): CoreAction {
  return { action: 'Ctx', args: { action: 'RewindLibraryItem', args: id } };
}

export function removeFromLibraryAction(id: string): CoreAction {
  return { action: 'Ctx', args: { action: 'RemoveFromLibrary', args: id } };
}

export function playerAction(action: string, args?: unknown): CoreAction {
  return { action: 'Player', args: { action, ...(args === undefined ? {} : { args }) } };
}
