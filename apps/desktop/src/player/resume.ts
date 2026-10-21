import type { LibraryPlaybackProgress } from '../core/types';

/** The saved offset, only when Core saved it for the video being played. */
export function resumeOffset(saved: LibraryPlaybackProgress | null, playingId: string) {
  return saved?.videoId === playingId ? saved.timeOffset : 0;
}
