import type { CoreVideo } from '../core/types';

export function inUpNextWindow(time: number, duration: number) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(time) &&
    time >= duration - Math.min(120_000, duration * 0.1)
  );
}

/** Core's next video, offered only for a series and never when it is announced but not out. */
export function upNextVideo(
  type: string,
  playingId: string,
  next: CoreVideo | null,
): CoreVideo | null {
  return type === 'series' && next && next.id !== playingId && !next.upcoming ? next : null;
}
