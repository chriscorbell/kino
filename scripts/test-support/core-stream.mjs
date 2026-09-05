import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { loadPlayerAction } from '../../apps/desktop/src/core/actions.ts';

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));

// Run the pinned WASM serializer with synthetic metadata and in-memory storage.
// Every Core fetch stays in this fixture; it never contacts an add-on or account.
export async function initializeCore({ storage = new Map(), onEvent = () => {} } = {}) {
  Object.assign(globalThis, {
    WorkerGlobalScope: { [Symbol.hasInstance]: () => true },
    self: globalThis,
    window: globalThis,
    document: { baseURI: 'https://kino.invalid/' },
    app_version: '0.0.0',
    shell_version: null,
    get_location_hash: async () => '',
  });
  globalThis.local_storage_get_item = async (key) => storage.get(key) ?? null;
  globalThis.local_storage_set_item = async (key, value) => storage.set(key, value);
  globalThis.local_storage_remove_item = async (key) => storage.delete(key);
  globalThis.fetch = async () => Response.json({ meta: fixtureMeta });
  const core = require('@stremio/stremio-core-web/stremio_core_web.js');
  await core.default({
    module_or_path: readFileSync(
      require.resolve('@stremio/stremio-core-web/stremio_core_web_bg.wasm'),
    ),
  });
  await core.initialize_runtime(onEvent);
  return core;
}

const fixtureMeta = {
  id: 'kino-fixture',
  type: 'movie',
  name: 'Synthetic fixture',
  posterShape: 'poster',
  videos: [],
  inLibrary: false,
  watched: false,
};

export const fixturePreview = {
  background: null,
  defaultVideoId: null,
  description: null,
  id: fixtureMeta.id,
  inLibrary: false,
  logo: null,
  name: fixtureMeta.name,
  poster: null,
  posterShape: 'poster',
  releaseInfo: null,
  released: null,
  runtime: null,
  type: fixtureMeta.type,
  watched: false,
};

/**
 * Build the application source a screen would hand to the player from a raw
 * add-on stream, so a check can start from the wire shape an add-on returns.
 */
export function fixtureSource(stream) {
  const hints = stream.behaviorHints ?? {};
  const source = stream.infoHash
    ? {
        kind: 'torrent',
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        sources: stream.sources ?? stream.announce ?? [],
      }
    : stream.ytId
      ? { kind: 'youtube', ytId: stream.ytId }
      : stream.externalUrl
        ? { kind: 'external', externalUrl: stream.externalUrl }
        : stream.playerFrameUrl
          ? { kind: 'playerFrame', playerFrameUrl: stream.playerFrameUrl }
          : { kind: 'url', url: stream.url };
  return {
    description: stream.description ?? null,
    name: stream.name ?? null,
    source,
    hints: {
      bingeGroup: hints.bingeGroup ?? null,
      countryWhitelist: hints.countryWhitelist ?? null,
      filename: hints.filename ?? null,
      notWebReady: hints.notWebReady ?? null,
      proxyRequestHeaders: hints.proxyHeaders?.request ?? null,
      proxyResponseHeaders: hints.proxyHeaders?.response ?? null,
      videoHash: hints.videoHash ?? null,
      videoSize: hints.videoSize ?? null,
    },
  };
}

export async function resolveCoreStream(core, stream) {
  core.dispatch(
    loadPlayerAction({
      meta: fixturePreview,
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      stream: fixtureSource(stream),
      streamTransportUrl: 'https://addon.invalid/manifest.json',
      video: null,
      nextVideo: null,
    }),
    'player',
    '',
  );
  await new Promise((resolve) => setImmediate(resolve));
  const state = core.get_state('player').stream;
  if (state?.type !== 'Ready') throw new Error('Core did not resolve the synthetic stream.');
  return state.content;
}
