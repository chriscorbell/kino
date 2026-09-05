#!/usr/bin/env node

import assert from 'node:assert/strict';

import { adaptContinueWatchingState, adaptCoreState } from '../apps/desktop/src/core/adapters.ts';
import { loadPlayerAction, playerAction } from '../apps/desktop/src/core/actions.ts';
import { torrentCreateRequest } from '../apps/desktop/src/player/torrent.ts';
import {
  fixturePreview,
  fixtureSource,
  initializeCore,
  resolveCoreStream,
} from './test-support/core-stream.mjs';

const core = await initializeCore();
const tracker = 'https://tracker.invalid/announce';
const raw = await resolveCoreStream(core, {
  infoHash: '0123456789abcdef0123456789abcdef01234567',
  fileIdx: 0,
  sources: [`tracker:${tracker}`, 'dht:0123456789abcdef0123456789abcdef01234567'],
});
assert.equal(raw.sources, undefined, 'Core serializes sources as announce.');
assert.deepEqual(raw.announce, [
  `tracker:${tracker}`,
  'dht:0123456789abcdef0123456789abcdef01234567',
]);
const resolved = adaptCoreState('player', core.get_state('player')).stream;
assert.equal(resolved.type, 'Ready');
assert.equal(resolved.content.source.kind, 'torrent');
const request = torrentCreateRequest(
  'http://127.0.0.1:1234/kino/test-capability',
  resolved.content.source,
);
assert.deepEqual(
  request.body.peerSearch?.sources,
  [tracker],
  'The resolved Core trackers must reach the magnet endpoint in peerSearch.sources.',
);
assert.equal(request.body.guessFileIdx, false);
console.log('Pinned Core torrent resolution preserves trackers in the engine request.');

for (const stream of [
  fixtureSource({
    url: 'https://media.invalid/remembered.mp4',
    behaviorHints: {
      proxyHeaders: { request: { Referer: 'https://media.invalid/' } },
    },
  }),
  fixtureSource({
    infoHash: '0123456789abcdef0123456789abcdef01234567',
    fileIdx: 2,
    sources: ['tracker:https://tracker.invalid/announce'],
  }),
]) {
  core.dispatch(
    loadPlayerAction({
      meta: fixturePreview,
      metaTransportUrl: 'https://metadata.invalid/manifest.json',
      streamTransportUrl: 'https://streams.invalid/manifest.json',
      stream,
      video: null,
      nextVideo: null,
    }),
    'player',
    '',
  );
  await new Promise((resolve) => setImmediate(resolve));
  core.dispatch(playerAction('VideoParamsChanged', { videoParams: null }), 'player', '');
  core.dispatch(
    playerAction('TimeChanged', { time: 30000, duration: 120000, device: 'kino' }),
    'player',
    '',
  );
  core.dispatch(playerAction('PausedChanged', { paused: true }), 'player', '');
  await new Promise((resolve) => setImmediate(resolve));
  core.dispatch({ action: 'Unload' }, 'player', '');
  await new Promise((resolve) => setImmediate(resolve));
  const item = adaptContinueWatchingState(
    core.get_state('continue_watching_preview'),
    core.decode_stream,
  ).items[0];
  assert.equal(item.progress, 25);
  assert.deepEqual(item.rememberedSource, {
    stream,
    transportUrl: 'https://streams.invalid/manifest.json',
  });
}
console.log(
  'Pinned Core Continue Watching links preserve the last source, headers, add-on, and progress.',
);
process.exit(0);
