import type { CoreAction, CoreMetaPreview, CoreStream, CoreVideo } from './types';

export interface PlaybackSelection {
  meta: CoreMetaPreview;
  metaTransportUrl: string;
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

export function playerAction(action: string, args?: unknown): CoreAction {
  return { action: 'Player', args: { action, ...(args === undefined ? {} : { args }) } };
}
