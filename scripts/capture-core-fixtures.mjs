#!/usr/bin/env node
// Regenerate apps/desktop/src/core/fixtures/core-state.json from the pinned
// @stremio/stremio-core-web WASM.
//
//   PATH=/opt/homebrew/opt/node@24/bin:$PATH node scripts/capture-core-fixtures.mjs
//
// Everything is synthetic: an in-memory profile store, an intercepted fetch
// that answers from the fixtures below, and no add-on or account request leaves
// this process. Only the models and fields Kino's adapters read are kept, so
// the committed file stays small enough to review.

import { writeFileSync } from 'node:fs';

import { addonFromManifest } from '../apps/desktop/src/core/adapters.ts';
import {
  installAddonAction,
  loadCatalogAction,
  loadLibraryAction,
  loadMetaDetailsAction,
  loadPlayerAction,
  loadSearchAction,
  playerAction,
} from '../apps/desktop/src/core/actions.ts';
import { initializeCore } from './test-support/core-stream.mjs';

const CORE_VERSION = '0.61.0';
const transportUrl = 'https://fixture.invalid/manifest.json';
const meta = {
  id: 'kino-fixture',
  type: 'series',
  name: 'Synthetic series',
  poster: 'https://fixture.invalid/poster.jpg',
  posterShape: 'landscape',
  releaseInfo: '2024-',
  videos: [{ id: 'kino-fixture:1:1', season: 1, episode: 1, title: 'Pilot' }],
};
const addon = addonFromManifest(transportUrl, {
  id: 'kino.fixture',
  name: 'Contract fixture',
  version: '1.0.0',
  types: ['series'],
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  catalogs: [
    {
      type: 'series',
      id: 'fixture',
      name: 'Fixture',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', options: ['Drama', 'Comedy'] },
        { name: 'skip' },
      ],
    },
  ],
});
const streams = [
  {
    name: 'Direct',
    url: 'https://media.invalid/fixture.mp4',
    behaviorHints: {
      filename: 'fixture.mkv',
      proxyHeaders: { request: { Authorization: 'synthetic' } },
      videoHash: '0123456789abcdef',
      videoSize: 123456,
    },
  },
  {
    name: 'Torrent',
    infoHash: '0123456789abcdef0123456789abcdef01234567',
    fileIdx: 0,
    // An add-on sends `sources`; every Core serializer emits `announce`.
    sources: ['tracker:https://tracker.invalid/announce', 'dht:0123456789abcdef'],
  },
  { name: 'External', externalUrl: 'https://external.invalid/watch' },
  { name: 'Embedded', playerFrameUrl: 'https://embedded.invalid/watch' },
  { name: 'Youtube', ytId: 'synthetic' },
];

const core = await initializeCore();
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
globalThis.fetch = async (request) => {
  const path = new URL(typeof request === 'string' ? request : request.url).pathname;
  if (path.includes('/catalog/')) return Response.json({ metas: [meta] });
  if (path.includes('/stream/')) return Response.json({ streams });
  if (path.includes('/subtitles/')) {
    return Response.json({
      subtitles: [
        { id: 'sub-en', lang: 'eng', url: 'https://fixture.invalid/en.srt' },
        { id: 'sub-plain', lang: 'ger', url: 'http://fixture.invalid/de.srt' },
      ],
    });
  }
  return Response.json({ meta });
};

const snapshots = {};
const take = (name, model) => {
  snapshots[name] = { model, state: core.get_state(model) };
};

core.dispatch(installAddonAction(addon), undefined, '');
// Keep one preinstalled official descriptor beside the fixture one: a complete
// manifest is what install and uninstall have to round-trip.
snapshots.guest_ctx = {
  model: 'ctx',
  state: {
    profile: {
      ...core.get_state('ctx').profile,
      addons: core
        .get_state('ctx')
        .profile.addons.filter(
          (installed) =>
            installed.manifest.id === addon.manifest.id ||
            installed.manifest.id === 'com.linvo.cinemeta',
        ),
    },
  },
};
core.dispatch(
  loadCatalogAction({
    base: transportUrl,
    path: { resource: 'catalog', type: 'series', id: 'fixture', extra: [['genre', 'Drama']] },
  }),
  'discover',
  '',
);
core.dispatch(loadMetaDetailsAction(meta, 'kino-fixture:1:1'), 'meta_details', '');
core.dispatch({ action: 'Ctx', args: { action: 'AddToLibrary', args: meta } }, undefined, '');
core.dispatch(loadLibraryAction({ page: 1, type: 'series', sort: 'lastwatched' }), 'library', '');
take('loading_discover', 'discover');
await tick();
take('ready_discover', 'discover');
take('ready_library', 'library');
take('ready_meta_details', 'meta_details');

for (const stream of streams) {
  core.dispatch({ action: 'Unload' }, 'player', '');
  core.dispatch(
    loadPlayerAction({
      meta,
      metaTransportUrl: transportUrl,
      streamTransportUrl: transportUrl,
      stream: adaptedFixtureSource(stream),
      video: meta.videos[0],
      nextVideo: null,
    }),
    'player',
    '',
  );
  await tick();
  take(`player_${stream.name.toLowerCase()}`, 'player');
}
core.dispatch(
  playerAction('TimeChanged', { time: 30000, duration: 120000, device: 'kino' }),
  'player',
  '',
);
core.dispatch(playerAction('PausedChanged', { paused: true }), 'player', '');
await tick();
core.dispatch({ action: 'Unload' }, 'player', '');
await tick();
take('continue_watching', 'continue_watching_preview');

globalThis.fetch = async () => new Response(null, { status: 503 });
core.dispatch(loadSearchAction('failed'), 'search', '');
core.dispatch(
  {
    action: 'CatalogsWithExtra',
    args: {
      action: 'LoadRange',
      args: { start: 0, end: core.get_state('search').catalogs.length },
    },
  },
  'search',
  '',
);
core.dispatch({ action: 'Unload' }, 'meta_details', '');
core.dispatch(loadMetaDetailsAction({ ...meta, id: 'failed' }, 'failed:1:1'), 'meta_details', '');
await tick();
take('failed_search', 'search');
take('failed_meta_details', 'meta_details');

/**
 * The capture drives production `loadPlayerAction`, which takes an adapted
 * source. Build the minimum the outbound serializer needs from a raw fixture.
 */
function adaptedFixtureSource(stream) {
  const source = stream.infoHash
    ? {
        kind: 'torrent',
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        sources: stream.sources ?? [],
      }
    : stream.ytId
      ? { kind: 'youtube', ytId: stream.ytId }
      : stream.externalUrl
        ? { kind: 'external', externalUrl: stream.externalUrl }
        : stream.playerFrameUrl
          ? { kind: 'playerFrame', playerFrameUrl: stream.playerFrameUrl }
          : { kind: 'url', url: stream.url };
  const hints = stream.behaviorHints ?? {};
  return {
    description: null,
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

// Only the top-level model fields the adapters read. Everything else is large
// and unused, and a fixture that carries it invites tests to depend on it.
const readFields = {
  ctx: ['profile'],
  continue_watching_preview: ['items'],
  discover: ['catalog', 'selectable', 'selected'],
  library: ['catalog', 'selectable', 'selected'],
  meta_details: ['libraryItem', 'metaItem', 'selected', 'streams', 'title'],
  player: ['libraryItem', 'selected', 'stream', 'subtitles', 'title'],
  search: ['catalogs', 'selected'],
};

function pick(state, model) {
  return Object.fromEntries(readFields[model].map((key) => [key, state[key]]));
}

/** Trim the parts of a snapshot the adapters never read. */
function trim(value, depth = 0) {
  if (Array.isArray(value)) return value.map((entry) => trim(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    // Deep links are the adapter's own concern for Discover only; everywhere
    // else they are large encoded payloads with no application meaning.
    if (key === 'externalPlayer' || key === 'trailerStreams') continue;
    if (key === 'deepLinks') {
      const discover = entry?.discover;
      if (typeof discover !== 'string') continue;
      result[key] = { discover };
      continue;
    }
    result[key] = trim(entry, depth + 1);
  }
  return result;
}

const target = new URL('../apps/desktop/src/core/fixtures/core-state.json', import.meta.url);
writeFileSync(
  target,
  `${JSON.stringify(
    {
      _provenance: {
        core: `@stremio/stremio-core-web ${CORE_VERSION}`,
        generatedBy: 'scripts/capture-core-fixtures.mjs',
        note: 'Synthetic data, in-memory storage, intercepted fetch. Regenerate with the script; do not edit by hand.',
      },
      ...Object.fromEntries(
        Object.entries(snapshots).map(([key, { model, state }]) => [
          key,
          { model, state: trim(pick(state, model)) },
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(`Captured ${Object.keys(snapshots).length} pinned Core ${CORE_VERSION} snapshots.`);
process.exit(0);
