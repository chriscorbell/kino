#!/usr/bin/env node
// Run Kino's production Core adapters against the pinned
// @stremio/stremio-core-web WASM. A fixture-only test cannot notice an upstream
// serializer change; this reads live state from the real serializer and asserts
// the application values every screen and the player depend on.
//
// Synthetic metadata, in-memory storage, intercepted fetch. No add-on or
// account request leaves this process and no user profile is read.

import assert from 'node:assert/strict';

import {
  loadCatalogAction,
  loadLibraryAction,
  loadMetaDetailsAction,
  loadPlayerAction,
  installAddonAction,
} from '../apps/desktop/src/core/actions.ts';
import {
  adaptCoreState,
  addonFromManifest,
  CoreContractError,
} from '../apps/desktop/src/core/adapters.ts';
import { classifySource, sourceKey } from '../apps/desktop/src/core/sources.ts';
import { torrentCreateRequest, resolveFileIndex } from '../apps/desktop/src/player/torrent.ts';
import { initializeCore } from './test-support/core-stream.mjs';

const transportUrl = 'https://fixture.invalid/manifest.json';
const tracker = 'https://tracker.invalid/announce';
const infoHash = '0123456789abcdef0123456789abcdef01234567';
const meta = {
  id: 'kino-fixture',
  type: 'series',
  name: 'Synthetic series',
  posterShape: 'poster',
  videos: [{ id: 'kino-fixture:1:1', season: 1, episode: 1, title: 'Pilot' }],
};
// The add-on answers with `sources`; Core renames it to `announce` everywhere.
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
  { name: 'Torrent', infoHash, fileIdx: 0, sources: [`tracker:${tracker}`, `dht:${infoHash}`] },
  { name: 'Pack', infoHash, sources: [`tracker:${tracker}`] },
  { name: 'External', externalUrl: 'https://external.invalid/watch' },
  { name: 'Embedded', playerFrameUrl: 'https://embedded.invalid/watch' },
  { name: 'Youtube', ytId: 'synthetic' },
];

const core = await initializeCore();
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const read = (model) => adaptCoreState(model, core.get_state(model));
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
      extra: [{ name: 'genre', options: ['Drama', 'Comedy'] }, { name: 'skip' }],
    },
  ],
});

/* Every readable model adapts from its own initial state. -------------------- */

const models = [
  'board',
  'continue_watching_preview',
  'ctx',
  'discover',
  'library',
  'meta_details',
  'player',
  'search',
];
for (const model of models) read(model);
console.log('Pinned Core: every readable model adapts from its initial serialized state.');

/* Profile round trip -------------------------------------------------------- */

core.dispatch(installAddonAction(addon), undefined, '');
const profile = read('ctx');
assert.equal(profile.profile.auth, null, 'A guest profile serializes auth as null.');
const installed = profile.profile.addons.find((entry) => entry.manifest.id === 'kino.fixture');
assert.ok(installed, 'The installed descriptor must survive the adapter.');
assert.deepEqual(
  installed.manifest.values.resources,
  ['catalog', 'meta', 'stream', 'subtitles'],
  'The complete manifest has to round-trip; Core rejects a descriptor without its resources.',
);
assert.equal(typeof profile.profile.settings.values.streamingServerUrl, 'string');
assert.equal(profile.profile.settings.subtitlesLanguage, 'eng');

/* Discover: adapted options produce working Load actions --------------------- */

core.dispatch(
  loadCatalogAction({
    base: transportUrl,
    path: { resource: 'catalog', type: 'series', id: 'fixture', extra: [['genre', 'Drama']] },
  }),
  'discover',
  '',
);
await tick();
const discover = read('discover');
assert.equal(typeof discover.selectable.nextPage, 'boolean');
assert.equal(discover.catalog.content.type, 'Ready');
const comedy = discover.selectable.extra
  .find((extra) => extra.name === 'genre')
  .options.find((option) => option.value === 'Comedy');
assert.ok(comedy.request, 'Core offers a destination for an available genre.');
core.dispatch(loadCatalogAction(comedy.request), 'discover', '');
await tick();
assert.deepEqual(
  read('discover').selected.request.path.extra,
  [['genre', 'Comedy']],
  'A Load built from an adapted option has to select that catalog filter.',
);
const clearFilter = discover.selectable.extra
  .find((extra) => extra.name === 'genre')
  .options.find((option) => option.value === null);
core.dispatch(loadCatalogAction(clearFilter.request), 'discover', '');
await tick();
assert.deepEqual(read('discover').selected.request.path.extra, []);
console.log('Pinned Core: adapted Discover options load the catalogs they name.');

/* Library: derived requests, nullable type, paging flag ---------------------- */

core.dispatch(loadMetaDetailsAction(meta, 'kino-fixture:1:1'), 'meta_details', '');
core.dispatch({ action: 'Ctx', args: { action: 'AddToLibrary', args: meta } }, undefined, '');
core.dispatch(loadLibraryAction({ page: 1, sort: 'lastwatched', type: 'series' }), 'library', '');
await tick();
const library = read('library');
assert.equal(typeof library.selectable.nextPage, 'boolean');
assert.deepEqual(library.selected.request, { page: 1, sort: 'lastwatched', type: 'series' });
const allTypes = library.selectable.types.find((type) => type.type === null);
assert.deepEqual(allTypes.request, { page: 1, sort: 'lastwatched', type: null });
const byName = library.selectable.sorts.find((sort) => sort.sort === 'name');
assert.deepEqual(byName.request, { page: 1, sort: 'name', type: 'series' });
core.dispatch(loadLibraryAction(byName.request), 'library', '');
await tick();
const resorted = read('library');
assert.equal(resorted.selected.request.sort, 'name');
assert.equal(resorted.selected.request.type, 'series');
assert.equal(resorted.catalog[0].id, 'kino-fixture');
core.dispatch(loadLibraryAction(allTypes.request), 'library', '');
await tick();
assert.equal(read('library').selected.request.type, null);
console.log('Pinned Core: adapted Library options load with the sort, type, and page they name.');

/* MetaDetails source rows already carry announce ----------------------------- */

const details = read('meta_details');
assert.equal(details.streams[0].content.type, 'Ready');
const sources = details.streams[0].content.content;
assert.deepEqual(
  sources.map((source) => classifySource(source.source)),
  ['direct', 'torrent', 'torrent', 'external', 'unsupported', 'unsupported'],
  'Well-formed sources Kino cannot play stay visible instead of failing the model.',
);
const rawRows = core.get_state('meta_details').streams[0].content.content;
assert.equal(rawRows[1].sources, undefined);
assert.deepEqual(
  rawRows[1].announce,
  [`tracker:${tracker}`, `dht:${infoHash}`],
  'MetaDetails source rows are serialized with announce, not sources.',
);
const [, torrentRow, packRow] = sources;
assert.deepEqual(torrentRow.source, {
  fileIdx: 0,
  infoHash,
  kind: 'torrent',
  sources: [`tracker:${tracker}`, `dht:${infoHash}`],
});
assert.deepEqual(
  sources[0].hints.proxyRequestHeaders,
  { Authorization: 'synthetic' },
  'Request headers survive to the native player.',
);

/* The full torrent path, through production code ----------------------------- */

const selection = {
  meta: adaptCoreState('meta_details', core.get_state('meta_details')).metaItem.content.content,
  metaTransportUrl: transportUrl,
  streamTransportUrl: transportUrl,
  stream: torrentRow,
  video: null,
  nextVideo: null,
};
core.dispatch({ action: 'Unload' }, 'player', '');
core.dispatch(loadPlayerAction(selection), 'player', '');
await tick();
const player = read('player');
assert.equal(player.stream.type, 'Ready');
const resolved = player.stream.content.source;
assert.equal(resolved.kind, 'torrent', 'A resolved torrent carries Core’s own URL too.');
assert.ok(
  core.get_state('player').stream.content.url.startsWith('http://127.0.0.1'),
  'Core resolves the torrent to its default streaming server.',
);
const request = torrentCreateRequest('http://127.0.0.1:1234/kino/test', resolved);
assert.deepEqual(
  request.body.peerSearch.sources,
  [tracker],
  'The tracker discovered by the add-on must reach the engine in peerSearch.sources.',
);
assert.equal(request.body.guessFileIdx, false, 'An explicit file index is not guessed.');
assert.equal(resolveFileIndex(resolved, { guessedFileIdx: 5 }), 0);
assert.deepEqual(
  player.selected.stream.source,
  torrentRow.source,
  'The outbound Load has to reproduce the selected source exactly.',
);

core.dispatch({ action: 'Unload' }, 'player', '');
core.dispatch(loadPlayerAction({ ...selection, stream: packRow }), 'player', '');
await tick();
const pack = read('player').stream.content.source;
assert.equal(pack.fileIdx, null);
assert.equal(torrentCreateRequest('http://127.0.0.1:1234/kino/test', pack).body.guessFileIdx, true);
assert.equal(resolveFileIndex(pack, { guessedFileIdx: 5 }), 5);

const key = (source) => sourceKey(source, transportUrl, { meta: selection.meta, video: null });
assert.notEqual(
  key(torrentRow),
  key({ ...torrentRow, source: { ...torrentRow.source, sources: [`tracker:${tracker}/other`] } }),
  'Changing only the discovery hints changes the source identity.',
);
console.log(
  'Pinned Core: an add-on tracker survives MetaDetails, the Player Load, and the engine request.',
);

/* Direct stream with request headers ---------------------------------------- */

core.dispatch({ action: 'Unload' }, 'player', '');
core.dispatch(loadPlayerAction({ ...selection, stream: sources[0] }), 'player', '');
await tick();
const direct = read('player');
assert.equal(direct.stream.content.source.kind, 'url');
assert.ok(
  core.get_state('player').stream.content.url.includes('/proxy/'),
  'Core wraps a header-bearing direct stream in its streaming-server proxy.',
);
assert.deepEqual(
  direct.selected.stream.hints.proxyRequestHeaders,
  { Authorization: 'synthetic' },
  'Kino keeps the original headers so the native player can send them itself.',
);
assert.equal(direct.selected.stream.source.url, 'https://media.invalid/fixture.mp4');
// Core replaces the add-on's own subtitle id with one scoped to the descriptor.
assert.deepEqual(
  direct.subtitles,
  [{ id: `${transportUrl}_0`, lang: 'eng', url: 'https://fixture.invalid/en.srt' }],
  'Add-on subtitles are validated and plaintext tracks are skipped.',
);
console.log('Pinned Core: a direct source keeps its original HTTPS URL and request headers.');

/* Unsupported but well-formed sources still load ----------------------------- */

for (const row of sources.slice(3)) {
  core.dispatch({ action: 'Unload' }, 'player', '');
  core.dispatch(loadPlayerAction({ ...selection, stream: row }), 'player', '');
  await tick();
  const state = read('player');
  assert.equal(state.stream.type, 'Ready', `${row.name} must not fail the model.`);
  assert.equal(state.selected.stream.source.kind, row.source.kind);
}
console.log('Pinned Core: external, embedded, and YouTube sources adapt without a model error.');

/* Failed resources stay failures -------------------------------------------- */

globalThis.fetch = async () => new Response(null, { status: 503 });
core.dispatch({ action: 'Unload' }, 'meta_details', '');
core.dispatch(loadMetaDetailsAction({ ...meta, id: 'failed' }, 'failed:1:1'), 'meta_details', '');
await tick();
const failed = read('meta_details');
assert.equal(failed.metaItem.content.type, 'Err');
assert.equal(failed.metaItem.content.content.kind, 'Env');
assert.equal(failed.streams[0].content.type, 'Err');
console.log('Pinned Core: a provider failure stays an Err rather than an empty Ready.');

/* A contradicted contract rejects the read ---------------------------------- */

const corrupted = structuredClone(core.get_state('discover'));
corrupted.selectable.nextPage = 'yes';
assert.throws(
  () => adaptCoreState('discover', corrupted),
  (error) =>
    error instanceof CoreContractError &&
    error.message.includes('discover.selectable.nextPage') &&
    !error.message.includes('yes'),
  'An incompatible payload rejects the read with a safe model and field path.',
);
console.log('Pinned Core: an incompatible payload is rejected before it reaches a screen.');

process.exit(0);
