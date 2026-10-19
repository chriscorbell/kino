// One interface over the two players Kino has: libmpv behind the WebChannel,
// and the browser's <video> that vitest and the web build use. Each backend
// parses its own events into MediaEvent, so the player handles them once and
// both report progress, pause and end the same way.

import type { ChapterCue } from '../intro/markers';
import type { AudioTrack } from '../player/audio';
import type { SubtitleTrack } from '../player/subtitles';

/** Why the media itself failed. `failures.ts` turns it into locale text. */
export type MediaFailure =
  | 'player-unavailable'
  | 'render-context-unavailable'
  | 'hardware-decoding-unavailable'
  | 'dolby-vision-unsupported'
  | 'native-playback-failed'
  | 'browser-start-rejected'
  | 'browser-playback-failed';

/** Stable codes and numbers only, so it can go to the diagnostic log as is. */
export type MediaDiagnostic = Readonly<Record<string, string | number>>;

/**
 * Parsed at the backend from mpv's untyped `playerEvent(name, payload)` or
 * from DOM media events. Every number is finite and in milliseconds or
 * percent; a payload that fails to parse never becomes an event.
 */
export type MediaEvent =
  | { type: 'time'; milliseconds: number }
  /** 0 while the duration is unknown, as for a live stream. */
  | { type: 'duration'; milliseconds: number }
  | { type: 'buffered'; milliseconds: number }
  | { type: 'paused'; paused: boolean }
  | { type: 'buffering'; active: boolean }
  /**
   * The first frame is coming: mpv's PLAYBACK_RESTART, or loadedmetadata. The
   * browser adds whether it is paused, since loading a new source can pause
   * it without a pause event.
   */
  | { type: 'ready'; paused?: boolean }
  | { type: 'ended' }
  | { type: 'volume'; percent: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'audioTracks'; tracks: AudioTrack[] }
  | { type: 'subtitleTracks'; tracks: SubtitleTrack[] }
  | { type: 'chapters'; cues: ChapterCue[] }
  | { type: 'failed'; failure: MediaFailure; detail: MediaDiagnostic };

export interface MediaLoadRequest {
  url: string;
  /** Proxy headers for an HTTPS direct source; empty otherwise. */
  headers: Readonly<Record<string, string>>;
  stereo: boolean;
  /** The profile's audio language at the moment playback started. */
  audioLanguage: string;
  /** Applied inside `load`, before the source opens, so no caller has to order the two. */
  matchRefreshRate: boolean;
}

/** A time and duration pair Core can store. */
export interface MediaPosition {
  time: number;
  duration: number;
}

/** A position Core can store, or null when either half is unknown. */
export function mediaPosition(time: number, duration: number): MediaPosition | null {
  return Number.isFinite(time) && Number.isFinite(duration) && duration > 0
    ? { time, duration }
    : null;
}

/**
 * Commands take Kino's units (milliseconds, percent, null for off) and each
 * backend converts. Every command is safe to call before `load` and after
 * `stop`; the backend drops what it cannot apply.
 */
export interface MediaBackend {
  /** Only the native player can list and switch audio and subtitle tracks. */
  readonly capabilities: { readonly tracks: boolean };
  subscribe(listener: (event: MediaEvent) => void): () => void;
  load(request: MediaLoadRequest): void;
  setPaused(paused: boolean): void;
  seek(milliseconds: number): void;
  setVolume(percent: number): void;
  setMuted(muted: boolean): void;
  setAudioTrack(id: number): void;
  setSubtitleTrack(id: number | null): void;
  /** `token` comes back as the track title, so a result can be matched to its request. */
  addSubtitles(url: string, token: string, language: string): void;
  setSubtitleDelay(milliseconds: number): void;
  setSubtitleStyle(style: { size: number; position: number }): void;
  setMatchRefreshRate(enabled: boolean): void;
  setNowPlaying(title: string, subtitle: string): void;
  /** Pauses and reads the exact position, for the final save. */
  freeze(): Promise<MediaPosition | null>;
  stop(): void;
}
