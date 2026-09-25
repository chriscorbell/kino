import type { ChapterCue } from '../intro/markers';
import { t as enUS } from '../locales';

export function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const padded = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${padded(minutes)}:${padded(remainder)}`
    : `${minutes}:${padded(remainder)}`;
}

export function nativeErrorMessage(code: unknown) {
  if (code === 'hardware-decoding-unavailable') {
    return enUS.player.hardwareDecodingFailed;
  }
  if (code === 'render-context-unavailable') {
    return enUS.player.rendererFailed;
  }
  if (code === 'player-unavailable') {
    return enUS.player.playerUnavailable;
  }
  return enUS.player.nativePlaybackFailed;
}

export function nativeChapterCues(value: unknown): ChapterCue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ChapterCue[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const { startMs, title } = candidate as Record<string, unknown>;
    return typeof startMs === 'number' && Number.isFinite(startMs) && typeof title === 'string'
      ? [{ startMs, title }]
      : [];
  });
}
