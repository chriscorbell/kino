#!/usr/bin/env node

import assert from 'node:assert/strict';

import { adaptCoreState } from '../apps/desktop/src/core/adapters.ts';
import { torrentCreateRequest } from '../apps/desktop/src/player/torrent.ts';
import { initializeCore, resolveCoreStream } from './test-support/core-stream.mjs';

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
process.exit(0);
