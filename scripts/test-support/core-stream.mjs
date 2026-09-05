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
  videos: [],
  inLibrary: false,
  watched: false,
};

export async function resolveCoreStream(core, stream) {
  core.dispatch(
    loadPlayerAction({
      meta: fixtureMeta,
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      stream: { deepLinks: { player: '' }, ...stream },
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
