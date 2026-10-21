// The owner of one playback: the Core Player model, the source, the media
// backend, progress, track memory, volume and the exit. Plain TypeScript with
// no React, so its lifetime is the viewing's and not a component's mount.
// StrictMode, an unmount, or a new callback identity has nothing to restart or
// tear down out of order (#91).

import type { ClientPlatform } from '@kino/settings';

import { loadPlayerAction, type PlaybackSelection } from '../core/actions.ts';
import { coreFailureDetail } from '../core/errors.ts';
import type { CoreResolvedStream, PlayerState } from '../core/types';
import { t as enUS } from '../locales/index.ts';
import type { NativePlayer } from '../native/player';
import { videoParams } from '../player/videoParams.ts';
import { subtitlePositionRange, subtitleSizeRange, volumeRange } from '../settings.ts';
import { createExit } from './exit.ts';
import { mediaFailureMessage } from './failures.ts';
import type { MediaBackend, MediaEvent } from './media';
import { mpvBackend } from './mpvBackend.ts';
import { createProgressReporter, type ProgressReporter } from './progress.ts';
import { directSource, streamTorrent, type ReportFailure, type ResolvedSource } from './source.ts';
import { createTracks } from './tracks.ts';
import type { PlaybackDeps, PlaybackSession, PlaybackSnapshot } from './types';
import { videoBackend } from './videoBackend.ts';
import { observeVolume, sentVolume, type InFlightVolumes } from './volume.ts';

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.max(min, Math.min(max, value));

/**
 * Starts loading at once. The caller is App's play handler, an event, so each
 * viewer action loads once. Progress shows in the snapshot, and the outcome
 * reaches `deps.onFinished` once the final save is durable.
 */
export function startPlayback(selection: PlaybackSelection, deps: PlaybackDeps): PlaybackSession {
  const { core, settings } = deps;
  const listeners = new Set<() => void>();
  const cleanups: (() => void)[] = [];
  let snapshot: PlaybackSnapshot = {
    title: selection.meta.name,
    waitingFor: { core: true, player: deps.native.present, peers: false },
    kind: deps.native.present ? 'native' : 'browser',
    loaded: false,
    exit: 'open',
    position: { time: 0, duration: 0, buffered: 0 },
    paused: true,
    buffering: false,
    ended: false,
    muted: false,
    audioTracks: [],
    subtitles: { tracks: [], addon: [], delayMs: 0 },
    chapters: [],
    nativeFullscreen: null,
  };
  const publish = ({
    waitingFor,
    ...patch
  }: Partial<Omit<PlaybackSnapshot, 'waitingFor'>> & {
    waitingFor?: Partial<PlaybackSnapshot['waitingFor']>;
  }) => {
    snapshot = {
      ...snapshot,
      ...patch,
      ...(waitingFor ? { waitingFor: { ...snapshot.waitingFor, ...waitingFor } } : {}),
    };
    listeners.forEach((listener) => listener());
  };

  // True once the exit stopped the player: nothing reads, reports or fails after it.
  let stopped = false;
  // Stopped or saving: nothing loads, and media events and commands that move
  // playback are dropped. A save that fails before the stop reopens playback and
  // loads a source that arrived meanwhile; one that fails after the stop does not.
  const frozen = () => stopped || snapshot.exit === 'saving';
  let failed = false;
  let native: NativePlayer | null = null;
  let backend: MediaBackend | null = null;
  let resolved: CoreResolvedStream | null = null;
  let source: ResolvedSource | null = null;
  let profile: { audio: string; subtitles: string | null } | null = null;
  let platform: ClientPlatform | null = null;
  let progress: ProgressReporter | null = null;
  // The audio output the current load opened with; null before the first load.
  let loadedAudioOutput: string | null = null;
  let applied: { matchRefreshRate: boolean; size: number; position: number } | null = null;
  let inFlight: InFlightVolumes = [];
  let resumeAt = 0;
  let resumed = false;

  const tracks = createTracks({
    title: selection.meta,
    storage: deps.storage,
    defaults: () => ({ enabled: settings.get().subtitles, language: profile?.subtitles ?? null }),
    onChange: ({ audio, subtitles, addon }) =>
      publish({
        audioTracks: audio,
        subtitles: { ...snapshot.subtitles, tracks: subtitles, addon },
      }),
  });

  // The contract on failure: save progress, record a sanitized diagnostic, and
  // report the outcome so App marks the source failed for this selection.
  const fail: ReportFailure = (message, diagnostic = {}) => {
    if (failed || stopped) return;
    failed = true;
    console.error('[kino:player] source failed', { message, ...diagnostic });
    void exit({ kind: 'failed', message }).catch(() => undefined);
  };

  /* Core's Player model. This session is its only reader and writer. ------- */

  const coreFailed = (step: 'action' | 'state') => (error: unknown) => {
    console.error(
      `[kino:core] player ${step} failed`,
      coreFailureDetail(error, enUS.core.modelFailed),
    );
    publish({ waitingFor: { core: false } });
    fail(enUS.player.prepareFailed);
  };
  const readPlayer = () =>
    core.getState('player').then((state) => {
      if (!stopped) onPlayer(state);
    }, coreFailed('state'));
  const unwatch = core.subscribe((event) => {
    if (event.name === 'NewState' && event.args.includes('player')) void readPlayer();
  });
  const loaded = core.dispatch(loadPlayerAction(selection), 'player');
  loaded.then(readPlayer, coreFailed('action'));

  function onPlayer(state: PlayerState | null) {
    const title = state?.title ?? selection.meta.name;
    const retitled = title !== snapshot.title;
    publish({ title, waitingFor: { core: false } });
    if (retitled) nowPlaying();
    tracks.offered(state?.subtitles ?? []);
    resumeAt = state?.libraryItem?.timeOffset ?? 0;
    resume();
    if (state?.stream?.type === 'Err') {
      fail(enUS.player.resolveFailed);
    } else if (state?.stream?.type === 'Ready' && !resolved) {
      resolved = state.stream.content;
      resolveSource();
    }
  }

  // The profile's languages are read once, so a profile sync during playback
  // cannot reload the stream.
  core.getState('ctx').then(
    ({ profile: { settings: languages } }) => {
      profile = { audio: languages.audioLanguage ?? '', subtitles: languages.subtitlesLanguage };
      startLoad();
    },
    () => {
      profile = { audio: '', subtitles: null };
      startLoad();
    },
  );
  // A failed report fails the same connection the player needs, which reports it.
  deps.platform.then(
    (answer) => {
      platform = answer;
      startLoad();
    },
    () => undefined,
  );

  /* The source and the backend. -------------------------------------------- */

  function resolveSource() {
    if (!resolved || source || snapshot.waitingFor.peers || stopped) return;
    if (resolved.source.kind !== 'torrent') {
      playSource(directSource(selection, resolved));
    } else if (native) {
      publish({ waitingFor: { peers: true } });
      cleanups.push(
        streamTorrent(resolved.source, native, {
          fetch: deps.fetch,
          fail,
          onUrl: (url) => playSource({ url, headers: {} }),
        }),
      );
    }
  }

  function playSource(next: ResolvedSource | null) {
    if (!next || stopped) return;
    source = next;
    publish({ loaded: true, waitingFor: { peers: false } });
    startLoad();
  }

  function connectBackend(target: MediaBackend) {
    backend = target;
    cleanups.push(target.subscribe(onMedia), settings.subscribe(applySettings));
    applySettings();
    nowPlaying();
    startLoad();
  }

  const browser = deps.native.present ? null : videoBackend();
  if (browser) {
    connectBackend(browser);
  } else {
    deps.native.connect().then(
      (player) => {
        if (!player || stopped) return;
        native = player;
        publish({ nativeFullscreen: player, waitingFor: { player: false } });
        connectBackend(mpvBackend(player));
        resolveSource();
      },
      (error: unknown) =>
        fail(enUS.player.connectionFailed, {
          code: error instanceof Error ? error.message : 'UnknownError',
        }),
    );
  }

  function nowPlaying() {
    backend?.setNowPlaying(snapshot.title, selection.video?.title ?? selection.meta.name);
  }

  // A send that skipped sentVolume would come back looking like a change made outside Kino.
  function sendVolume(percent: number) {
    if (!backend || !source) return;
    inFlight = sentVolume(inFlight, percent, performance.now());
    backend.setVolume(percent);
  }

  function startLoad() {
    if (loadedAudioOutput === null) load();
  }

  function load() {
    if (!backend || !source || !profile || !platform || frozen()) return;
    loadedAudioOutput = settings.get().audioOutput;
    tracks.load(backend);
    progress = createProgressReporter(core, platform);
    sendVolume(settings.get().volume);
    backend.load({
      ...source,
      stereo: loadedAudioOutput === 'stereo',
      audioLanguage: profile.audio,
      matchRefreshRate: settings.get().matchRefreshRate,
    });
  }

  // `load` sends the refresh-rate preference a source opens with; this sends later changes.
  function applySettings() {
    if (!backend) return;
    const { audioOutput, matchRefreshRate, subtitlePosition, subtitleSize } = settings.get();
    if (applied?.matchRefreshRate !== matchRefreshRate)
      backend.setMatchRefreshRate(matchRefreshRate);
    if (applied?.size !== subtitleSize || applied.position !== subtitlePosition) {
      backend.setSubtitleStyle({ size: subtitleSize, position: subtitlePosition });
    }
    applied = { matchRefreshRate, size: subtitleSize, position: subtitlePosition };
    if (loadedAudioOutput !== null && audioOutput !== loadedAudioOutput && !frozen()) {
      backend.stop();
      load();
    }
  }

  /* What the player reports. ---------------------------------------------- */

  function onMedia(event: MediaEvent) {
    if (frozen()) return;
    const { position } = snapshot;
    switch (event.type) {
      case 'time':
        publish({
          position: { ...position, time: event.milliseconds },
          ...(event.milliseconds < position.time ? { ended: false } : {}),
        });
        progress?.time(snapshot.position);
        break;
      case 'duration':
        publish({ position: { ...position, duration: event.milliseconds } });
        resume();
        break;
      case 'buffered':
        publish({ position: { ...position, buffered: event.milliseconds } });
        break;
      case 'paused':
        publish({ paused: event.paused, ...(event.paused ? {} : { ended: false }) });
        progress?.paused(event.paused, position);
        break;
      case 'buffering':
        tracks.buffering();
        publish({ buffering: event.active });
        break;
      case 'ready':
        if (event.paused !== undefined) publish({ paused: event.paused });
        tracks.ready();
        progress?.mediaReady(videoParams(selection.stream));
        break;
      case 'ended':
        publish({ buffering: false, paused: true, ended: true });
        progress?.ended(position);
        break;
      case 'volume': {
        const observed = observeVolume(inFlight, event.percent, performance.now());
        inFlight = observed.inFlight;
        if (observed.adopt !== null) settings.update({ volume: observed.adopt });
        break;
      }
      case 'muted':
        publish({ muted: event.muted });
        break;
      case 'chapters':
        publish({ chapters: event.cues });
        break;
      case 'audioTracks':
        tracks.audioTracks(event.tracks);
        break;
      case 'subtitleTracks':
        tracks.subtitleTracks(event.tracks);
        break;
      case 'failed':
        publish({ buffering: false, paused: true });
        fail(mediaFailureMessage(event.failure), event.detail);
        break;
    }
  }

  // Seeks once, when a stored offset and the duration are first both known,
  // so no Core snapshot after that moves the viewer.
  function resume() {
    const { duration } = snapshot.position;
    if (resumed || duration <= 0 || resumeAt <= 0 || resumeAt >= duration) return;
    resumed = true;
    controls.seek(resumeAt);
  }

  /* The exit. ------------------------------------------------------------- */

  const exit = createExit({
    core,
    steps: {
      async freeze() {
        const frozen = await backend?.freeze();
        if (frozen) publish({ position: { ...snapshot.position, ...frozen } });
        return snapshot.position;
      },
      loaded,
      stop() {
        stopped = true;
        progress = null;
        backend?.stop();
        unwatch();
      },
      platform: () => platform,
    },
    onState(state) {
      publish(state === 'saving' ? { exit: state, paused: true } : { exit: state });
      if (state === 'save-failed') startLoad();
    },
    onFinished(outcome) {
      cleanups.forEach((cleanup) => cleanup());
      deps.onFinished(outcome);
    },
  });
  cleanups.push(core.onBeforeDestroy(() => exit({ kind: 'closed' })));

  const controls: PlaybackSession['controls'] = {
    // Core hears the change from the player's own pause event, not from here.
    togglePause() {
      if (frozen() || !backend) return;
      const paused = !snapshot.paused;
      publish({ paused });
      backend.setPaused(paused);
    },
    seek(milliseconds) {
      if (frozen()) return;
      const time = Math.max(0, milliseconds);
      publish({ ended: false, position: { ...snapshot.position, time } });
      backend?.seek(time);
      progress?.seek(snapshot.position);
    },
    setVolume(percent) {
      if (!Number.isFinite(percent)) return;
      const volume = clamp(percent, volumeRange);
      settings.update({ volume });
      sendVolume(volume);
      if (volume > 0 && snapshot.muted) {
        publish({ muted: false });
        backend?.setMuted(false);
      }
    },
    toggleMute() {
      const muted = !snapshot.muted;
      publish({ muted });
      backend?.setMuted(muted);
    },
    selectAudio: (id) => tracks.selectAudio(id),
    selectSubtitle(id) {
      if (tracks.selectSubtitle(id)) settings.update({ subtitles: id !== null });
    },
    addAddonSubtitle(subtitle) {
      if (tracks.addAddon(subtitle)) settings.update({ subtitles: true });
    },
    adjustSubtitleDelay(deltaMs) {
      const delayMs = clamp(snapshot.subtitles.delayMs + deltaMs, { min: -60_000, max: 60_000 });
      publish({ subtitles: { ...snapshot.subtitles, delayMs } });
      if (backend?.capabilities.tracks) backend.setSubtitleDelay(delayMs);
    },
    adjustSubtitleSize(delta) {
      settings.update({
        subtitleSize: clamp(settings.get().subtitleSize + delta, subtitleSizeRange),
      });
    },
    adjustSubtitlePosition(delta) {
      settings.update({
        subtitlePosition: clamp(settings.get().subtitlePosition + delta, subtitlePositionRange),
      });
    },
    // A failed save shows in the snapshot, and leaving again retries it.
    leave(intent) {
      void exit(intent).catch(() => undefined);
    },
  };

  return {
    selection,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    controls,
    attach: (video) => browser?.attach(video) ?? (() => {}),
  };
}
