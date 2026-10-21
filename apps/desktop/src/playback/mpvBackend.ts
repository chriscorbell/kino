// The native player behind the WebChannel as a MediaBackend. Apart from the
// native probes' test pages, this is the only client code that reads
// `playerEvent` payloads, so a renamed key fails one parser and its unit test
// instead of silently dropping events in a component.

import type { ChapterCue } from '../intro/markers';
import type { NativePlayer } from '../native/player';
import { parseAudioTracks } from '../player/audio.ts';
import { parseSubtitleTracks } from '../player/subtitles.ts';
import { mediaPosition, type MediaBackend, type MediaEvent, type MediaFailure } from './media.ts';

export function mpvBackend(native: NativePlayer): MediaBackend {
  return {
    capabilities: { tracks: true },
    subscribe(listener) {
      const reported = new Set<string>();
      const onEvent = (name: string, payload: Record<string, unknown>) => {
        const event = parseNativeEvent(name, payload, reported);
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

interface Decoder {
  read(payload: Record<string, unknown>): MediaEvent | null;
  /** What an unreadable payload still means, when the name alone carries it. */
  unreadable?: MediaEvent;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const millisecondsEvent = (type: 'time' | 'duration' | 'buffered'): Decoder => ({
  read: ({ milliseconds }) => (finite(milliseconds) ? { type, milliseconds } : null),
});

const flagEvent = (key: string, event: (value: boolean) => MediaEvent): Decoder => ({
  read: (payload) => {
    const value = payload[key];
    return typeof value === 'boolean' ? event(value) : null;
  },
});

// A list the shell could not send reads as empty, so the player drops the
// previous source's tracks or chapters instead of showing them.
const listEvent = (event: (items: unknown[]) => MediaEvent): Decoder => ({
  read: ({ items }) => (Array.isArray(items) ? event(items) : null),
  unreadable: event([]),
});

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
  ['paused', flagEvent('paused', (paused) => ({ type: 'paused', paused }))],
  ['muted', flagEvent('muted', (muted) => ({ type: 'muted', muted }))],
  ['buffering', flagEvent('active', (active) => ({ type: 'buffering', active }))],
  [
    'volume',
    {
      read: ({ percent }) =>
        finite(percent) ? { type: 'volume', percent: Math.max(0, Math.min(100, percent)) } : null,
    },
  ],
  ['ready', { read: () => ({ type: 'ready' }) }],
  ['ended', { read: () => ({ type: 'ended' }) }],
  ['audioTracks', listEvent((items) => ({ type: 'audioTracks', tracks: parseAudioTracks(items) }))],
  [
    'subtitleTracks',
    listEvent((items) => ({ type: 'subtitleTracks', tracks: parseSubtitleTracks(items) })),
  ],
  ['chapters', listEvent((items) => ({ type: 'chapters', cues: chapterCues(items) }))],
  [
    'error',
    {
      read: ({ code }) =>
        typeof code === 'string'
          ? {
              type: 'failed',
              failure: nativeFailures.get(code) ?? 'native-playback-failed',
              detail: { code },
            }
          : null,
      // The source failed whatever the payload says. Ignoring the event would
      // leave the viewer on a player that will never play.
      unreadable: {
        type: 'failed',
        failure: 'native-playback-failed',
        detail: { code: 'unknown' },
      },
    },
  ],
  ['hardwareDecoding', null],
  ['refreshRate', null],
]);

/**
 * Turns one `playerEvent` into a MediaEvent, or null. An event this client
 * cannot read is logged by its name alone, since payloads can carry track
 * titles the diagnostic log never holds. `reported` holds the names already
 * logged, so a drifted `time` payload, sent once per frame, logs once.
 */
export function parseNativeEvent(
  name: string,
  payload: Record<string, unknown>,
  reported = new Set<string>(),
): MediaEvent | null {
  const decoder = decoders.get(name);
  if (decoder === null) return null;
  const event = decoder?.read(payload);
  if (event) return event;
  if (!reported.has(name)) {
    reported.add(name);
    console.warn('[kino:player] unreadable native event', name);
  }
  return decoder?.unreadable ?? null;
}
