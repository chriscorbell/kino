import type {
  CatalogRequest,
  CoreAddon,
  CoreMetaPreview,
  CoreProfileSettings,
  CoreSource,
  CoreSourceHints,
  CoreVideo,
  LibraryRequest,
} from './types';
import { durable, transient, type DurableAction, type TransientAction } from './writes.ts';

export interface PlaybackSelection {
  meta: CoreMetaPreview;
  metaTransportUrl: string;
  nextVideo: CoreVideo | null;
  stream: CoreSource;
  streamTransportUrl: string;
  video: CoreVideo | null;
}

export const loadBoardAction: TransientAction = transient({
  action: 'Load',
  args: { model: 'CatalogsWithExtra', args: { extra: [] } },
});

export function loadSearchAction(query: string): TransientAction {
  return transient({
    action: 'Load',
    args: {
      model: 'CatalogsWithExtra',
      args: { extra: [['search', query]] },
    },
  });
}

/** Asks Core for every catalog row of the board or a search, not only the first ones. */
export function loadCatalogRangeAction(end: number): TransientAction {
  return transient({
    action: 'CatalogsWithExtra',
    args: { action: 'LoadRange', args: { start: 0, end } },
  });
}

export function loadCatalogAction(request: CatalogRequest | null): TransientAction {
  return transient({
    action: 'Load',
    args: { model: 'CatalogWithFilters', args: request ? { request } : null },
  });
}

export const loadNextCatalogPageAction: TransientAction = transient({
  action: 'CatalogWithFilters',
  args: { action: 'LoadNextPage' },
});

export function loadLibraryAction(request: LibraryRequest | null): TransientAction {
  return transient({
    action: 'Load',
    args: {
      model: 'LibraryWithFilters',
      args: { request: request ?? { page: 1, sort: 'lastwatched', type: null } },
    },
  });
}

export function loadMetaDetailsAction(
  meta: CoreMetaPreview,
  videoId: string | null,
): TransientAction {
  return transient({
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
  });
}

export const unloadAction: TransientAction = transient({ action: 'Unload' });

/** Unloading the player can advance Continue Watching to the next episode, so it is a save too. */
export const unloadPlayerAction: DurableAction = durable({ action: 'Unload' });

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

export function loadPlayerAction(selection: PlaybackSelection): TransientAction {
  const videoId = selection.video?.id ?? selection.meta.id;
  return transient({
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
  });
}

/**
 * Sign-in succeeds on Core's UserAuthenticated event, after the dispatch has
 * returned, so waiting for storage here would wait for nothing.
 */
export function loginAction(email: string, password: string): TransientAction {
  return transient({
    action: 'Ctx',
    args: { action: 'Authenticate', args: { type: 'Login', email, password } },
  });
}

export const logoutAction: DurableAction = durable({ action: 'Ctx', args: { action: 'Logout' } });

export function updateProfileSettingsAction(
  settings: CoreProfileSettings,
  patch: Record<string, unknown>,
): DurableAction {
  // Core replaces the whole settings record, so the unread values go back too.
  return durable({
    action: 'Ctx',
    args: { action: 'UpdateSettings', args: { ...settings.values, ...patch } },
  });
}

interface AddonDescriptor {
  flags: { official: boolean; protected: boolean };
  manifest: Readonly<Record<string, unknown>>;
  transportUrl: string;
}

function addonPayload(addon: CoreAddon): AddonDescriptor {
  return {
    flags: { official: addon.flags.official, protected: addon.flags.protected },
    manifest: addon.manifest.values,
    transportUrl: addon.transportUrl,
  };
}

export function installDescriptorAction(descriptor: AddonDescriptor): DurableAction {
  return durable({ action: 'Ctx', args: { action: 'InstallAddon', args: descriptor } });
}

export function installAddonAction(addon: CoreAddon): DurableAction {
  return installDescriptorAction(addonPayload(addon));
}

export function uninstallAddonAction(addon: CoreAddon): DurableAction {
  return durable({ action: 'Ctx', args: { action: 'UninstallAddon', args: addonPayload(addon) } });
}

export function addToLibraryAction(meta: CoreMetaPreview): DurableAction {
  return durable({
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
  });
}

export function rewindLibraryItemAction(id: string): DurableAction {
  return durable({ action: 'Ctx', args: { action: 'RewindLibraryItem', args: id } });
}

export function removeFromLibraryAction(id: string): DurableAction {
  return durable({ action: 'Ctx', args: { action: 'RemoveFromLibrary', args: id } });
}

export type PlayerReport =
  'Ended' | 'PausedChanged' | 'Seek' | 'TimeChanged' | 'VideoParamsChanged';

/** Reports playback to Core while it runs. The final save supersedes these reports. */
export function playerAction(action: PlayerReport, args?: unknown): TransientAction {
  return transient({ action: 'Player', args: { action, ...(args === undefined ? {} : { args }) } });
}

/**
 * TimeChanged is throttled by Core. PausedChanged forces the current library
 * item into storage and account sync before Unload clears it.
 */
export const finalPauseAction: DurableAction = durable({
  action: 'Player',
  args: { action: 'PausedChanged', args: { paused: true } },
});

/**
 * Marks the open title watched or unwatched. Core records it on the title's library item, which
 * it creates for a title outside the library, so this works from any details page.
 */
export function markWatchedAction(watched: boolean): DurableAction {
  return durable({ action: 'MetaDetails', args: { action: 'MarkAsWatched', args: watched } });
}

/** Core reads only the episode's id, and its release date to order the library's last watched. */
export function markVideoWatchedAction(video: CoreVideo, watched: boolean): DurableAction {
  return durable({
    action: 'MetaDetails',
    args: {
      action: 'MarkVideoAsWatched',
      args: [{ id: video.id, title: video.title, released: video.released }, watched],
    },
  });
}

export function markSeasonWatchedAction(season: number, watched: boolean): DurableAction {
  return durable({
    action: 'MetaDetails',
    args: { action: 'MarkSeasonAsWatched', args: [season, watched] },
  });
}
