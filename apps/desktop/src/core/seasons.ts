import type { CoreVideo, LibraryPlaybackProgress } from './types';

export function availableSeasons(videos: CoreVideo[]) {
  return [...new Set(videos.map((video) => video.season))].sort(
    (left, right) => (left ?? Infinity) - (right ?? Infinity),
  );
}

export function seasonEpisodes(videos: CoreVideo[], season: number | null) {
  return videos
    .filter((video) => video.season === season)
    .sort(
      (left, right) =>
        (left.episode ?? Infinity) - (right.episode ?? Infinity) || left.id.localeCompare(right.id),
    );
}

export function initialSeason(videos: CoreVideo[], progress: LibraryPlaybackProgress | null) {
  const seasons = availableSeasons(videos);
  const regular = seasons.filter((season): season is number => season !== null && season > 0);
  const fallback = regular.includes(1) ? 1 : (regular[0] ?? seasons[0] ?? null);
  const previous = videos.find((video) => video.id === progress?.videoId);
  if (!previous || (!previous.watched && !progress?.timeOffset)) return fallback;
  const season = previous.season;
  if (season === null || season === 0 || !previous.watched) return season;
  const episodes = seasonEpisodes(videos, season);
  // Include announced, unreleased episodes. The last released episode alone
  // does not establish the finale of an ongoing season.
  const finale =
    previous.episode !== null &&
    episodes.every((episode) => episode.episode !== null) &&
    episodes.at(-1)?.id === previous.id;
  return finale ? (regular.find((candidate) => candidate > season) ?? season) : season;
}
