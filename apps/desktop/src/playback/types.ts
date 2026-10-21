import type { ClientPlatform } from '@kino/settings';

import type { PlaybackSelection, TransientPlayerAction } from '../core/actions';
import type { AddonSubtitle, CoreRuntimeEvent, CoreStateMap, CoreVideo } from '../core/types';
import type { DurableAction } from '../core/writes';
import type { ChapterCue } from '../intro/markers';
import type { NativePlayer } from '../native/player';
import type { AudioTrack } from '../player/audio';
import type { SubtitleTrack } from '../player/subtitles';
import type { KinoSettingsStore } from '../settingsStore';
import type { MediaPosition } from './media';

/**
 * One viewing of one source, from the viewer choosing it until its final save
 * is durable. App starts it from an event and only the session ends itself,
 * so the view can mount, unmount and remount without starting, saving or
 * unloading anything.
 */
export interface PlaybackSession {
  readonly selection: PlaybackSelection;
  /** The same object until something changes, for useSyncExternalStore. */
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  readonly controls: PlaybackControls;
  /** The view lends the `<video>` a browser session plays into. Detaching never stops playback. */
  attach(video: HTMLVideoElement): () => void;
}

export interface PlaybackSnapshot {
  /** Core's title once it arrives, otherwise the title's name. */
  readonly title: string;
  /** What playback is still waiting for. More than one can be true at once. */
  readonly waitingFor: {
    /** Core has not answered the Load yet. */
    readonly core: boolean;
    /** The native shell is present and its player has not connected. */
    readonly player: boolean;
    /** A torrent is waiting for the streaming engine's media URL. */
    readonly peers: boolean;
  };
  /** Which player draws the picture. Only the native one lists and switches tracks. */
  readonly kind: 'native' | 'browser';
  /** The source's URL is known, so the surface and the controls apply. */
  readonly loaded: boolean;
  readonly exit: ExitState;
  readonly position: MediaPosition & { readonly buffered: number };
  readonly paused: boolean;
  readonly buffering: boolean;
  /** End of file reached and not since left by a seek, a rewind or play. */
  readonly ended: boolean;
  readonly muted: boolean;
  readonly audioTracks: AudioTrack[];
  readonly subtitles: {
    readonly tracks: SubtitleTrack[];
    /** Add-on subtitles Core offers that this load has not added. */
    readonly addon: AddonSubtitle[];
    readonly delayMs: number;
  };
  readonly chapters: ChapterCue[];
  /** What Up Next offers once the ending is near. */
  readonly nextVideo: CoreVideo | null;
  /** The shell window's fullscreen, once the native player connects. */
  readonly nativeFullscreen: NativeFullscreen | null;
}

export type NativeFullscreen = Pick<
  NativePlayer,
  'fullscreen' | 'fullscreenChanged' | 'setFullscreen'
>;

/** Playback stays open while saving and after a failed save, so Back can retry. */
export type ExitState = 'open' | 'saving' | 'save-failed';

/**
 * Each command carries its own policy: `seek` reports the seek to Core,
 * `setVolume` saves the Kino setting and unmutes, the track commands remember
 * the viewer's choice for the title, and `leave` runs the whole save.
 */
export interface PlaybackControls {
  togglePause(): void;
  seek(milliseconds: number): void;
  setVolume(percent: number): void;
  toggleMute(): void;
  selectAudio(id: number): void;
  /** Null turns subtitles off. */
  selectSubtitle(id: number | null): void;
  addAddonSubtitle(subtitle: AddonSubtitle): void;
  adjustSubtitleDelay(deltaMs: number): void;
  adjustSubtitleSize(delta: number): void;
  adjustSubtitlePosition(delta: number): void;
  /** Saves, unloads, then reports the outcome. Joins a save already running. */
  leave(intent: LeaveIntent): void;
}

export type LeaveIntent = { kind: 'back' } | { kind: 'upNext'; video: CoreVideo };

/** How a session ended, reported once, after Unload is durable. */
export type PlaybackOutcome =
  | LeaveIntent
  | { kind: 'failed'; message: string }
  /** Window close, Quit, or the Core session ending underneath playback. */
  | { kind: 'closed' };

/** What a session needs from Core. `CoreTransport` satisfies it. */
export interface PlayerCorePort {
  dispatch(action: TransientPlayerAction, model: 'player'): Promise<void>;
  commit(action: DurableAction, model: 'player'): Promise<void>;
  getState<Model extends 'player' | 'ctx'>(model: Model): Promise<CoreStateMap[Model]>;
  subscribe(listener: (event: CoreRuntimeEvent) => void): () => void;
  /** Runs before the transport closes: window close, Quit, and Core teardown end here. */
  onBeforeDestroy(callback: () => Promise<void>): () => void;
}

export interface PlaybackDeps {
  core: PlayerCorePort;
  settings: KinoSettingsStore;
  native: {
    /** The page runs inside the shell, so playback waits for the native player. */
    present: boolean;
    connect(): Promise<NativePlayer | null>;
  };
  /** The platform the shell reports, which names the device progress reports carry. */
  platform: Promise<ClientPlatform>;
  fetch: typeof fetch;
  /** Per-title track memory. */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onFinished(outcome: PlaybackOutcome): void;
}
