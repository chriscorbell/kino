import { expect, it } from 'vitest';

import { video } from '../test/coreState';
import { episodeFromVideoId, seasonEpisodes } from './seasons';

it('breaks an episode tie by video id in code unit order, whatever the locale', () => {
  const unnumbered = [video({ id: 'tt1:x:extra-a' }), video({ id: 'tt1:x:Extra-b' })];
  expect(seasonEpisodes(unnumbered, null).map((item) => item.id)).toEqual([
    'tt1:x:Extra-b',
    'tt1:x:extra-a',
  ]);
  const numbered = [
    video({ id: 'tt1:1:1:a', season: 1, episode: 1 }),
    video({ id: 'tt1:1:1:B', season: 1, episode: 1 }),
  ];
  expect(seasonEpisodes(numbered, 1).map((item) => item.id)).toEqual(['tt1:1:1:B', 'tt1:1:1:a']);
});

it('names a saved episode only from a Stremio series video id for that title', () => {
  expect(episodeFromVideoId('tt0903747', 'tt0903747:2:5')).toEqual({ season: 2, episode: 5 });
  expect(episodeFromVideoId('tt0903747', 'tt0903747:0:1')).toEqual({ season: 0, episode: 1 });
  // Another title's episode, an add-on's own id scheme, and a movie all stay unnamed.
  expect(episodeFromVideoId('tt0903747', 'tt1234567:2:5')).toBeNull();
  expect(episodeFromVideoId('kitsu:1', 'kitsu:1:12')).toBeNull();
  expect(episodeFromVideoId('show', 'show:episode-12')).toBeNull();
  expect(episodeFromVideoId('show', 'show:1:2:3')).toBeNull();
  expect(episodeFromVideoId('tt0012349', 'tt0012349')).toBeNull();
  expect(episodeFromVideoId('tt0012349', null)).toBeNull();
});
