import assert from 'node:assert/strict';
import {
  loadMetaDetailsAction,
  loadPlayerAction,
  playerAction,
  installAddonAction,
} from '../apps/desktop/src/core/actions.ts';
import { adaptCoreState, addonFromManifest } from '../apps/desktop/src/core/adapters.ts';
import {
  initialSeason,
  availableSeasons,
  seasonEpisodes,
} from '../apps/desktop/src/core/seasons.ts';
import { initializeCore } from './test-support/core-stream.mjs';

const core = await initializeCore();
const base = 'https://seasons.invalid/manifest.json';
const addon = addonFromManifest(base, {
  id: 'kino.seasons',
  name: 'Season fixture',
  version: '1.0.0',
  types: ['series'],
  resources: ['meta', 'stream'],
  catalogs: [],
});
core.dispatch(installAddonAction(addon), undefined, '');
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const read = () => adaptCoreState('meta_details', core.get_state('meta_details'));
let metadata;
let streamRequests = [];
globalThis.fetch = async (request) => {
  const path = new URL(typeof request === 'string' ? request : request.url).pathname;
  if (path.includes('/stream/')) {
    streamRequests.push(path);
    return Response.json({
      streams: [{ name: 'Fixture source', url: 'https://media.invalid/episode.mp4' }],
    });
  }
  return Response.json({ meta: metadata });
};
const ordinary = [
  [1, 1],
  [1, 2],
  [2, 1],
  [2, 2],
  [3, 1],
  [3, 2],
];
const cases = [
  { name: 'No progress', expected: 1 },
  { name: 'In progress', previous: [2, 1], expected: 2 },
  { name: 'In-progress finale', previous: [2, 2], expected: 2 },
  { name: 'Completed finale', previous: [1, 2], watched: true, expected: 2 },
  { name: 'Completed non-finale', previous: [2, 1], watched: true, expected: 2 },
  { name: 'Completed final season', previous: [3, 2], watched: true, expected: 3 },
  {
    name: 'Missing season one',
    episodes: [
      [0, 1],
      [4, 1],
      [9, 1],
    ],
    expected: 4,
  },
  {
    name: 'Sparse numbering',
    episodes: [
      [8, 11],
      [2, 9],
      [0, 1],
      [2, 3],
    ],
    previous: [2, 9],
    watched: true,
    expected: 8,
  },
  {
    name: 'Specials stay separate',
    previous: [0, 1],
    episodes: [
      [0, 1],
      [1, 1],
    ],
    watched: true,
    expected: 0,
  },
  {
    name: 'Only specials',
    episodes: [
      [0, 2],
      [0, 1],
    ],
    expected: 0,
  },
  {
    name: 'Upcoming finale',
    previous: [1, 2],
    episodes: [
      [1, 1],
      [1, 2],
      [1, 3, true],
      [2, 1, true],
    ],
    watched: true,
    expected: 1,
  },
  { name: 'Missing progress episode', previous: [1, 2], removePrevious: true, expected: 1 },
  { name: 'Unnumbered episodes', episodes: [[null, null]], expected: null },
];
for (const [index, scenario] of cases.entries()) {
  const id = `season-fixture-${index}`;
  const episodeId = (season, episode) => `${id}:${season}:${episode}`;
  metadata = {
    id,
    type: 'series',
    name: scenario.name,
    posterShape: 'poster',
    videos: (scenario.episodes ?? ordinary).map(([season, episode, upcoming]) => ({
      id: episodeId(season, episode),
      title: `Episode ${episode}`,
      ...(season === null ? {} : { season, episode }),
      released: upcoming ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
    })),
  };
  core.dispatch(loadMetaDetailsAction(metadata), 'meta_details', '');
  await tick();
  assert.equal(read().selected.streamPath, null, 'Series browsing must not guess an episode');
  assert.equal(streamRequests.length, 0, 'Opening a season list must not request sources');
  if (scenario.previous) {
    const videoId = episodeId(...scenario.previous);
    core.dispatch(loadMetaDetailsAction(metadata, videoId), 'meta_details', '');
    await tick();
    const state = read();
    assert.ok(streamRequests.length > 0, 'An explicit episode requests sources');
    const meta = state.metaItem.content.content;
    core.dispatch(
      loadPlayerAction({
        meta,
        metaTransportUrl: base,
        streamTransportUrl: base,
        stream: state.streams[0].content.content[0],
        video: meta.videos.find((video) => video.id === videoId),
        nextVideo: null,
      }),
      'player',
      '',
    );
    await tick();
    for (const time of [1, scenario.watched ? 90000 : 25000]) {
      core.dispatch(
        playerAction('TimeChanged', { time, duration: 100000, device: 'kino-macos' }),
        'player',
        '',
      );
    }
    core.dispatch({ action: 'Unload' }, 'player', '');
    core.dispatch({ action: 'Unload' }, 'meta_details', '');
    if (scenario.removePrevious)
      metadata.videos = metadata.videos.filter((video) => video.id !== videoId);
    streamRequests = [];
    core.dispatch(loadMetaDetailsAction(metadata), 'meta_details', '');
    await tick();
    const reopened = read();
    assert.equal(reopened.libraryItem.videoId, videoId, 'Core preserves the last played episode');
    if (!scenario.removePrevious)
      assert.equal(
        reopened.metaItem.content.content.videos.find((video) => video.id === videoId).watched,
        Boolean(scenario.watched),
      );
  }
  const state = read();
  const videos = state.metaItem.content.content.videos;
  assert.equal(initialSeason(videos, state.libraryItem), scenario.expected, scenario.name);
  assert.equal(streamRequests.length, 0, 'Returning to seasons must not request sources');
  for (const season of availableSeasons(videos)) {
    const episodes = seasonEpisodes(videos, season);
    assert.ok(episodes.every((video) => video.season === season));
    assert.deepEqual(
      episodes.map((video) => video.episode),
      episodes.map((video) => video.episode).sort((a, b) => (a ?? Infinity) - (b ?? Infinity)),
    );
  }
  console.log(`Pinned Core season selection: ${scenario.name}.`);
}
process.exit(0);
