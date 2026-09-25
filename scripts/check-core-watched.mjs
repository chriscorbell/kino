import assert from 'node:assert/strict';
import {
  installAddonAction,
  loadMetaDetailsAction,
  loadPlayerAction,
  markSeasonWatchedAction,
  markVideoWatchedAction,
  markWatchedAction,
  playerAction,
} from '../apps/desktop/src/core/actions.ts';
import { adaptCoreState, addonFromManifest } from '../apps/desktop/src/core/adapters.ts';
import { initializeCore } from './test-support/core-stream.mjs';

// Drives the pinned Core with the same actions the details page sends, and
// reads the watched flags back from the state the page renders.
const core = await initializeCore();
const base = 'https://watched.invalid/manifest.json';
core.dispatch(
  installAddonAction(
    addonFromManifest(base, {
      id: 'kino.watched',
      name: 'Watched fixture',
      version: '1.0.0',
      types: ['movie', 'series'],
      resources: ['meta', 'stream'],
      catalogs: [],
    }),
  ),
  undefined,
  '',
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const read = () => adaptCoreState('meta_details', core.get_state('meta_details'));
const metas = new Map();
globalThis.fetch = async (request) => {
  const path = new URL(typeof request === 'string' ? request : request.url).pathname;
  if (path.includes('/stream/'))
    return Response.json({
      streams: [{ name: 'Fixture source', url: 'https://media.invalid/video.mp4' }],
    });
  const id = decodeURIComponent(
    path
      .split('/')
      .at(-1)
      .replace(/\.json$/, ''),
  );
  return Response.json({ meta: metas.get(id) });
};
const open = async (meta) => {
  core.dispatch({ action: 'Unload' }, 'meta_details', '');
  core.dispatch(loadMetaDetailsAction(meta), 'meta_details', '');
  await tick();
  return read();
};
const mark = async (action) => {
  core.dispatch(action, 'meta_details', '');
  await tick();
  return read();
};
const title = (state) => state.metaItem.content.content;
const watchedIds = (state) =>
  title(state)
    .videos.filter((video) => video.watched)
    .map((video) => video.id)
    .sort();

const series = {
  id: 'watched-series',
  type: 'series',
  name: 'Watched series',
  posterShape: 'poster',
  videos: [1, 2].flatMap((season) =>
    [1, 2, 3].map((episode) => ({
      id: `watched-series:${season}:${episode}`,
      title: `Episode ${episode}`,
      season,
      episode,
      released: `2020-0${season}-0${episode}T00:00:00Z`,
    })),
  ),
};
metas.set(series.id, series);

let state = await open(series);
assert.deepEqual(watchedIds(state), [], 'A new title starts unwatched');
const episode = (state, id) => title(state).videos.find((video) => video.id === id);
state = await mark(markVideoWatchedAction(episode(state, 'watched-series:1:2'), true));
assert.deepEqual(watchedIds(state), ['watched-series:1:2'], 'One episode is marked');
assert.equal(
  title(state).inLibrary,
  false,
  'Marking watched does not add the title to the library',
);
state = await open(series);
assert.deepEqual(watchedIds(state), ['watched-series:1:2'], 'The mark survives reopening');
state = await mark(markVideoWatchedAction(episode(state, 'watched-series:1:2'), false));
assert.deepEqual(watchedIds(state), [], 'The episode is unmarked');
console.log('Pinned Core watched state: one episode.');

state = await mark(markSeasonWatchedAction(1, true));
assert.deepEqual(
  watchedIds(state),
  ['watched-series:1:1', 'watched-series:1:2', 'watched-series:1:3'],
  'Marking a season leaves the other season alone',
);
state = await mark(markVideoWatchedAction(episode(state, 'watched-series:2:1'), true));
state = await mark(markSeasonWatchedAction(1, false));
assert.deepEqual(watchedIds(state), ['watched-series:2:1'], 'Unmarking a season is scoped too');
state = await mark(markSeasonWatchedAction(2, false));
console.log('Pinned Core watched state: season.');

// Marking the episode that Continue Watching points at moves it to the next.
core.dispatch(loadMetaDetailsAction(series, 'watched-series:1:1'), 'meta_details', '');
await tick();
state = read();
core.dispatch(
  loadPlayerAction({
    meta: title(state),
    metaTransportUrl: base,
    streamTransportUrl: base,
    stream: state.streams[0].content.content[0],
    video: episode(state, 'watched-series:1:1'),
    nextVideo: episode(state, 'watched-series:1:2'),
  }),
  'player',
  '',
);
await tick();
for (const time of [1, 25000])
  core.dispatch(
    playerAction('TimeChanged', { time, duration: 100000, device: 'kino-macos' }),
    'player',
    '',
  );
core.dispatch({ action: 'Unload' }, 'player', '');
state = await open(series);
assert.equal(state.libraryItem.videoId, 'watched-series:1:1', 'Playback records the episode');
assert.ok(state.libraryItem.timeOffset > 0);
state = await mark(markVideoWatchedAction(episode(state, 'watched-series:1:1'), true));
assert.equal(state.libraryItem.videoId, 'watched-series:1:2', 'Progress moves to the next episode');
// Core leaves a 1 ms offset so the title stays in Continue Watching.
assert.equal(state.libraryItem.timeOffset, 1, 'The next episode starts from the beginning');
console.log('Pinned Core watched state: progress advances past a watched episode.');

const movie = { id: 'watched-movie', type: 'movie', name: 'Watched movie', posterShape: 'poster' };
metas.set(movie.id, movie);
state = await open(movie);
assert.equal(title(state).watched, false);
state = await mark(markWatchedAction(true));
assert.equal(title(state).watched, true, 'The movie is marked');
state = await open(movie);
assert.equal(title(state).watched, true, 'The movie mark survives reopening');
state = await mark(markWatchedAction(false));
assert.equal(title(state).watched, false, 'The movie is unmarked');
console.log('Pinned Core watched state: movie.');
process.exit(0);
