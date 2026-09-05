import type {
  CatalogRequest,
  CoreAction,
  CoreAddon,
  CoreMetaPreview,
  CoreStream,
  CoreVideo,
  LibraryRequest,
} from './types';

export interface PlaybackSelection {
  resumeMode?: 'resume' | 'start-over';
  meta: CoreMetaPreview;
  metaTransportUrl: string;
  nextVideo: CoreVideo | null;
  stream: CoreStream;
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
        guessStream: true,
      },
    },
  };
}

function streamPayload(stream: CoreStream) {
  const payload: Partial<CoreStream> = { ...stream };
  delete payload.deepLinks;
  delete payload.lastUsed;
  delete payload.progress;
  return payload;
}

export function loadPlayerAction(selection: PlaybackSelection): CoreAction {
  const videoId = selection.video?.id ?? selection.meta.id;
  return {
    action: 'Load',
    args: {
      model: 'Player',
      args: {
        stream: streamPayload(selection.stream),
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

export function updateProfileSettingsAction(settings: Record<string, unknown>): CoreAction {
  return { action: 'Ctx', args: { action: 'UpdateSettings', args: settings } };
}

export function installAddonAction(addon: CoreAddon): CoreAction {
  return { action: 'Ctx', args: { action: 'InstallAddon', args: addon } };
}

export function uninstallAddonAction(addon: CoreAddon): CoreAction {
  return { action: 'Ctx', args: { action: 'UninstallAddon', args: addon } };
}

export function addToLibraryAction(meta: CoreMetaPreview): CoreAction {
  return { action: 'Ctx', args: { action: 'AddToLibrary', args: meta } };
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
