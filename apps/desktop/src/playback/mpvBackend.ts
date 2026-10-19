// The native player behind the WebChannel as a MediaBackend. This is the only
// TypeScript that reads `playerEvent` payloads, so a renamed key fails one
// parser and its unit test instead of silently dropping events in a component.

import type { ChapterCue } from '../intro/markers';
import type { NativePlayer } from '../native/player';
import { parseAudioTracks } from '../player/audio';
import { parseSubtitleTracks } from '../player/subtitles';
import { mediaPosition, type MediaBackend, type MediaEvent, type MediaFailure } from './media';

export function mpvBackend(native: NativePlayer): MediaBackend {
  return {
    capabilities: { tracks: true },
    subscribe(listener) {
      const onEvent = (name: string, payload: Record<string, unknown>) => {
        const event = parseNativeEvent(name, payload);
        if (event) listener(event);
      };
      native.playerEvent.connect(onEvent);
      return () => native.playerEvent.disconnect(onEvent);
    },
    load({ url, headers, stereo, audioLanguage, matchRefreshRate }) {
      native.setMatchFrameRate?.(matchRefreshRate);
      // A shell from before per-title audio languages has only `load`.
      if (native.loadWithAudioLanguage) {
        native.loadWithAudioLanguage(url, stereo, headers, audioLanguage);
      } else {
        native.load(url, stereo, headers);
      }
    },
    setPaused: (paused) => native.setPaused(paused),
    seek: (milliseconds) => native.seek(milliseconds / 1000),
    setVolume: (percent) => native.setVolume(percent),
    setMuted: (muted) => native.setMuted(muted),
    setAudioTrack: (id) => native.setAudioTrack(id),
    setSubtitleTrack: (id) => native.setSubtitleTrack(id ?? 0),
    addSubtitles: (url, token, language) => native.addSubtitles(url, token, language),
    setSubtitleDelay: (milliseconds) => native.setSubtitleDelay(milliseconds / 1000),
    setSubtitleStyle({ size, position }) {
      native.setSubtitleScale(size / 100);
      native.setSubtitlePosition(position);
    },
    setMatchRefreshRate: (enabled) => native.setMatchFrameRate?.(enabled),
    setNowPlaying: (title, subtitle) => native.setNowPlayingMetadata(title, subtitle),
    async freeze() {
      const { time, duration } = await native.pauseAndSnapshot();
      return mediaPosition(time, duration);
    },
    stop: () => native.stop(),
  };
}

type Decoder = (payload: Record<string, unknown>) => MediaEvent | null;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const millisecondsEvent =
  (type: 'time' | 'duration' | 'buffered'): Decoder =>
  ({ milliseconds }) =>
    finite(milliseconds) ? { type, milliseconds } : null;

// Codes the shell sends that have their own text. Any other code, such as
// decoder-or-stream-failed, is a native playback failure.
const nativeFailures = new Map<unknown, MediaFailure>(
  (
    [
      'player-unavailable',
      'render-context-unavailable',
      'hardware-decoding-unavailable',
      'dolby-vision-unsupported',
    ] as const
  ).map((code) => [code, code]),
);

function chapterCues(items: unknown[]): ChapterCue[] {
  return items.flatMap((candidate): ChapterCue[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const { startMs, title } = candidate as Record<string, unknown>;
    return finite(startMs) && typeof title === 'string' ? [{ startMs, title }] : [];
  });
}

// `null` marks the events only the native probes read.
const decoders = new Map<string, Decoder | null>([
  ['time', millisecondsEvent('time')],
  ['duration', millisecondsEvent('duration')],
  ['buffered', millisecondsEvent('buffered')],
  ['paused', ({ paused }) => (typeof paused === 'boolean' ? { type: 'paused', paused } : null)],
  ['muted', ({ muted }) => (typeof muted === 'boolean' ? { type: 'muted', muted } : null)],
  [
    'buffering',
    ({ active }) => (typeof active === 'boolean' ? { type: 'buffering', active } : null),
  ],
  [
    'volume',
    ({ percent }) =>
      finite(percent) ? { type: 'volume', percent: Math.max(0, Math.min(100, percent)) } : null,
  ],
  ['ready', () => ({ type: 'ready' })],
  ['ended', () => ({ type: 'ended' })],
  [
    'audioTracks',
    ({ items }) =>
      Array.isArray(items) ? { type: 'audioTracks', tracks: parseAudioTracks(items) } : null,
  ],
  [
    'subtitleTracks',
    ({ items }) =>
      Array.isArray(items) ? { type: 'subtitleTracks', tracks: parseSubtitleTracks(items) } : null,
  ],
  [
    'chapters',
    ({ items }) => (Array.isArray(items) ? { type: 'chapters', cues: chapterCues(items) } : null),
  ],
  [
    'error',
    ({ code }) =>
      typeof code === 'string'
        ? {
            type: 'failed',
            failure: nativeFailures.get(code) ?? 'native-playback-failed',
            detail: { code },
          }
        : null,
  ],
  ['hardwareDecoding', null],
  ['refreshRate', null],
]);

/**
 * Turns one `playerEvent` into a MediaEvent, or null. An event this client
 * cannot read is logged by its name alone: payloads can carry track titles,
 * which the diagnostic log never holds.
 */
export function parseNativeEvent(
  name: string,
  payload: Record<string, unknown>,
): MediaEvent | null {
  const decode = decoders.get(name);
  if (decode === null) return null;
  const event = decode?.(payload) ?? null;
  if (!event) console.warn('[kino:player] unreadable native event', name);
  return event;
}
