import {
  ArrowLeft,
  ArrowsIn,
  ArrowsOut,
  Pause,
  Play,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  Subtitles,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { AudioTrackPicker } from '../components/AudioTrackPicker';
import { SubtitlePanel } from '../components/SubtitlePanel';
import { parseAudioTracks, type AudioTrack } from '../player/audio';
import {
  describeAddonSubtitle,
  describeTrack,
  loadTitleTrackChoices,
  rememberedAddonSubtitle,
  rememberedTrack,
  saveTitleTrackChoice,
  type TitleTrackChoices,
} from '../player/trackChoices';
import { loadPlayerAction, playerAction, type PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreVideo } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { connectNativePlayer, nativeShellPresent, type NativePlayer } from '../native/player';
import { formatTime, nativeChapterCues, nativeErrorMessage } from '../player/nativeEvents';
import {
  addonSubtitleLabel,
  parseSubtitleTracks,
  preferredSubtitleTrack,
  type AddonSubtitle,
  type SubtitleTrack,
} from '../player/subtitles';
import { subtitlePositionRange, subtitleSizeRange, type KinoSettings } from '../settings';
import { videoParams } from '../player/videoParams';
import { useFullscreen } from '../player/useFullscreen';
import { useIdleControls } from '../player/useIdleControls';
import { useIntroSkip } from '../player/useIntroSkip';
import { usePlayerKeyboard } from '../player/usePlayerKeyboard';
import { useTorrentStream } from '../player/useTorrentStream';

export function PlayerScreen({
  onBack,
  onSettingsChange,
  onSourceFailure,
  onUpNext,
  preferredAudioLanguage = null,
  preferredSubtitleLanguage,
  selection,
  settings,
}: {
  onBack: () => void;
  onSettingsChange: (settings: KinoSettings) => void;
  onSourceFailure: (message: string) => void;
  onUpNext: (video: CoreVideo) => void;
  preferredAudioLanguage?: string | null;
  preferredSubtitleLanguage: string | null;
  selection: PlaybackSelection;
  settings: KinoSettings;
}) {
  const { transport } = useCore();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef({ duration: 0, time: 0 });
  const closingRef = useRef(false);
  const navigationPendingRef = useRef(false);
  const [shutdownError, setShutdownError] = useState<string | null>(null);
  const lastProgressRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(settings.volume);
  const [buffering, setBuffering] = useState(false);
  const [nativePlayer, setNativePlayer] = useState<NativePlayer | null>(null);
  const {
    error: fullscreenError,
    exit: exitFullscreen,
    fullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen(containerRef, nativePlayer);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const subtitleMenuRef = useRef<HTMLDivElement>(null);
  const subtitleButtonRef = useRef<HTMLButtonElement>(null);
  const changeAudioMenu = useCallback((open: boolean) => {
    setAudioMenuOpen(open);
    if (open) setSubtitleMenuOpen(false);
  }, []);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [addedSubtitleUrls, setAddedSubtitleUrls] = useState<ReadonlySet<string>>(new Set());
  const failureReportedRef = useRef(false);
  const audioAutoDoneRef = useRef(false);
  const subtitleAutoDoneRef = useRef(false);
  const subtitleFallbackDoneRef = useRef(false);
  const nativeLoadReadyRef = useRef(false);
  const [nativeReadyVersion, setNativeReadyVersion] = useState(0);
  const trackChoicesRef = useRef<TitleTrackChoices>({});
  const addedAddonSubtitlesRef = useRef(new Map<number, AddonSubtitle>());
  const addonSubtitlesByTokenRef = useRef(new Map<string, AddonSubtitle>());
  const subtitleDefaults = useEffectEvent(() => ({
    enabled: settings.subtitles,
    language: preferredSubtitleLanguage,
  }));
  const videoParamsReportedRef = useRef(false);
  const [ended, setEnded] = useState(false);
  const result = useCoreModel(
    'player',
    loadPlayerAction(selection),
    `${selection.meta.id}:${selection.video?.id ?? 'movie'}:${selection.streamTransportUrl}`,
    { beforeUnload: (target, loaded) => saveBeforeUnload(target, loaded) },
  );
  const resolved = result.state?.stream?.type === 'Ready' ? result.state.stream.content : null;
  const resolvedTorrent = resolved?.source.kind === 'torrent' ? resolved.source : null;
  // Core wraps direct streams with proxy headers in a URL for the account's
  // Stremio Service. The native backend can send those headers itself, using
  // the original source URL independently of that service's address.
  const chosen = selection.stream.source;
  const directUrl = chosen.kind === 'url' && chosen.url.startsWith('https://') ? chosen.url : null;
  const requestHeaders = useMemo(
    () => (directUrl ? (selection.stream.hints.proxyRequestHeaders ?? {}) : {}),
    [directUrl, selection.stream],
  );
  const resumeTime = result.state?.libraryItem?.timeOffset ?? 0;
  const nativeShell = nativeShellPresent();
  const addonSubtitles = useMemo(() => result.state?.subtitles ?? [], [result.state?.subtitles]);
  const selectedSubtitleId = subtitleTracks.find((track) => track.selected)?.id ?? null;
  const nearEnd =
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(time) &&
    time >= duration - Math.min(120_000, duration * 0.1);

  const updateDuration = useCallback((milliseconds: number) => {
    playbackRef.current.duration = milliseconds;
    setDuration(milliseconds);
  }, []);

  const updateTime = useCallback((milliseconds: number) => {
    if (milliseconds < playbackRef.current.time) setEnded(false);
    playbackRef.current.time = milliseconds;
    setTime(milliseconds);
  }, []);

  const dispatchPlayer = useCallback(
    (action: string, args?: unknown) => {
      if (!transport) return;
      void transport.dispatch(playerAction(action, args), 'player').catch((error: unknown) => {
        console.error(
          '[kino:player] progress update failed',
          error instanceof Error ? error.message : error,
        );
      });
    },
    [transport],
  );

  const reportProgress = useCallback(
    (isSeek = false) => {
      if (closingRef.current) return;
      const video = videoRef.current;
      const progressDuration =
        video && Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : playbackRef.current.duration;
      const progressTime = video ? Math.round(video.currentTime * 1000) : playbackRef.current.time;
      if (progressDuration <= 0) return;
      const args = {
        device: nativeShell ? 'kino-macos' : 'kino-web',
        duration: progressDuration,
        time: progressTime,
      };
      dispatchPlayer(isSeek ? 'Seek' : 'TimeChanged', args);
    },
    [dispatchPlayer, nativeShell],
  );

  const reportMediaReady = useCallback(() => {
    if (!transport || closingRef.current || videoParamsReportedRef.current) return;
    videoParamsReportedRef.current = true;
    dispatchPlayer('VideoParamsChanged', { videoParams: videoParams(selection.stream) });
  }, [dispatchPlayer, selection.stream, transport]);

  async function saveBeforeUnload(target: CoreTransport, loaded: Promise<void>) {
    closingRef.current = true;
    setPaused(true);
    setShutdownError(null);
    try {
      if (nativePlayer) {
        const snapshot = await nativePlayer.pauseAndSnapshot();
        if (
          Number.isFinite(snapshot.duration) &&
          snapshot.duration > 0 &&
          Number.isFinite(snapshot.time)
        ) {
          playbackRef.current = snapshot;
        }
      } else if (videoRef.current) {
        const video = videoRef.current;
        playbackRef.current = {
          duration: Math.round(video.duration * 1000),
          time: Math.round(video.currentTime * 1000),
        };
        video.pause();
      }
      await loaded.catch(() => undefined);
      const progress = playbackRef.current;
      if (
        Number.isFinite(progress.duration) &&
        progress.duration > 0 &&
        Number.isFinite(progress.time)
      ) {
        await target.dispatch(
          playerAction('TimeChanged', {
            ...progress,
            device: nativeShell ? 'kino-macos' : 'kino-web',
          }),
          'player',
        );
      }
      // TimeChanged is throttled by Core. PausedChanged forces the current
      // library item into storage and account sync before Unload clears it.
      await target.dispatch(playerAction('PausedChanged', { paused: true }), 'player');
      await target.flush();
      nativePlayer?.stop();
    } catch (error) {
      closingRef.current = false;
      setShutdownError(enUS.player.saveFailed);
      throw error;
    }
  }

  const unloadPlayer = result.unload;
  const [saving, setSaving] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const finishPlayback = useCallback(
    (navigate: () => void) => {
      if (navigationPendingRef.current) return;
      navigationPendingRef.current = true;
      setSaving(true);
      void unloadPlayer()
        .then(navigate)
        .catch(() => {
          navigationPendingRef.current = false;
          setSaving(false);
          setShutdownError(enUS.player.saveFailed);
        });
    },
    [unloadPlayer],
  );

  // The contract on failure: save progress, record a sanitized diagnostic, mark
  // the source failed for this selection session, and return to the source list.
  const reportFailure = useCallback(
    (message: string, diagnostic: Record<string, unknown> = {}) => {
      if (failureReportedRef.current) return;
      failureReportedRef.current = true;
      console.error('[kino:player] source failed', { message, ...diagnostic });
      finishPlayback(() => onSourceFailure(message));
    },
    [finishPlayback, onSourceFailure],
  );

  const { torrent, torrentUrl } = useTorrentStream(resolvedTorrent, nativePlayer, reportFailure);
  const streamUrl = resolved
    ? torrent
      ? torrentUrl
      : (directUrl ?? (resolved.source.kind === 'url' ? resolved.source.url : null))
    : null;
  const controlsVisible = useIdleControls(
    topbarRef,
    controlsRef,
    paused ||
      buffering ||
      subtitleMenuOpen ||
      audioMenuOpen ||
      result.loading ||
      !streamUrl ||
      Boolean(shutdownError || fullscreenError),
  );

  const togglePlayback = useCallback(() => {
    if (closingRef.current) return;
    if (nativePlayer) {
      const nextPaused = !paused;
      setPaused(nextPaused);
      dispatchPlayer('PausedChanged', { paused: nextPaused });
      nativePlayer.setPaused(nextPaused);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    void video.play().catch((error: unknown) => {
      setPaused(true);
      reportFailure(enUS.player.startFailed, {
        code: error instanceof DOMException ? error.name : 'UnknownError',
      });
    });
  }, [dispatchPlayer, nativePlayer, paused, reportFailure]);

  const seekTo = useCallback(
    (milliseconds: number) => {
      if (closingRef.current) return;
      setEnded(false);
      const safeTime = Math.max(0, milliseconds);
      updateTime(safeTime);
      if (nativePlayer) {
        nativePlayer.seek(safeTime / 1000);
      } else if (videoRef.current) {
        videoRef.current.currentTime = safeTime / 1000;
      }
    },
    [nativePlayer, updateTime],
  );

  const changeVolume = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent)) return;
      const next = Math.max(0, Math.min(100, percent));
      setVolume(next);
      onSettingsChange({ ...settings, volume: next });
      if (next > 0 && muted) {
        setMuted(false);
        if (nativePlayer) nativePlayer.setMuted(false);
        else if (videoRef.current) videoRef.current.muted = false;
      }
    },
    [muted, nativePlayer, onSettingsChange, settings],
  );

  useEffect(() => {
    if (nativePlayer) nativePlayer.setVolume(settings.volume);
    else if (videoRef.current) videoRef.current.volume = settings.volume / 100;
  }, [nativePlayer, settings.volume, streamUrl]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (nativePlayer) {
      nativePlayer.setMuted(nextMuted);
    } else if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }, [muted, nativePlayer]);

  const intro = useIntroSkip({
    automatic: settings.automaticIntroSkipping,
    duration,
    nativePlayer,
    reportProgress,
    seekTo,
    selection,
    time,
    videoRef,
  });
  const { marker, setChapterCues } = intro;

  const currentTime = useCallback(
    () => (nativePlayer ? playbackRef.current.time : (videoRef.current?.currentTime ?? 0) * 1000),
    [nativePlayer],
  );
  const reportSeek = useCallback(() => reportProgress(true), [reportProgress]);
  const hasPlayer = useCallback(() => Boolean(nativePlayer || videoRef.current), [nativePlayer]);
  usePlayerKeyboard({
    hasPlayer,
    changeVolume,
    currentTime,
    exitFullscreen,
    fullscreen,
    menuOpen: subtitleMenuOpen || audioMenuOpen,
    onSeek: reportSeek,
    seekTo,
    toggleFullscreen,
    toggleMuted,
    togglePlayback,
    volume,
  });

  const selectSubtitleTrack = (id: number | null) => {
    if (!nativePlayer) return;
    subtitleAutoDoneRef.current = true;
    const track = subtitleTracks.find((candidate) => candidate.id === id);
    const addon = track?.external ? addedAddonSubtitlesRef.current.get(track.id) : undefined;
    if (id === null || track) {
      saveTitleTrackChoice(selection.meta, {
        subtitle:
          id === null
            ? { kind: 'off' }
            : addon
              ? describeAddonSubtitle(addon, addonSubtitles)
              : describeTrack(track!, subtitleTracks),
      });
    }
    nativePlayer.setSubtitleTrack(id ?? 0);
    if (settings.subtitles !== (id !== null)) {
      onSettingsChange({ ...settings, subtitles: id !== null });
    }
  };

  const attachAddonSubtitle = useCallback(
    (subtitle: AddonSubtitle) => {
      if (!nativePlayer) return;
      // mpv reports the supplied title but no add-request ID. An opaque title
      // correlates each result even when another same-language download fails.
      // Track snapshots replace it with the normal display label below.
      const token = crypto.randomUUID();
      addonSubtitlesByTokenRef.current.set(token, subtitle);
      nativePlayer.addSubtitles(subtitle.url, token, subtitle.lang);
    },
    [nativePlayer],
  );

  const addAddonSubtitle = (subtitle: AddonSubtitle) => {
    if (!nativePlayer || addedSubtitleUrls.has(subtitle.url)) return;
    subtitleAutoDoneRef.current = true;
    saveTitleTrackChoice(selection.meta, {
      subtitle: describeAddonSubtitle(subtitle, addonSubtitles),
    });
    setAddedSubtitleUrls((previous) => new Set(previous).add(subtitle.url));
    attachAddonSubtitle(subtitle);
    setSubtitleMenuOpen(false);
    if (!settings.subtitles) onSettingsChange({ ...settings, subtitles: true });
  };

  const changeSubtitleDelay = (deltaMs: number) => {
    const next = Math.max(-60_000, Math.min(60_000, subtitleDelayMs + deltaMs));
    setSubtitleDelayMs(next);
    nativePlayer?.setSubtitleDelay(next / 1000);
  };

  const changeSubtitleSize = (delta: number) => {
    const next = Math.max(
      subtitleSizeRange.min,
      Math.min(subtitleSizeRange.max, settings.subtitleSize + delta),
    );
    if (next !== settings.subtitleSize) onSettingsChange({ ...settings, subtitleSize: next });
  };

  const changeSubtitlePosition = (delta: number) => {
    const next = Math.max(
      subtitlePositionRange.min,
      Math.min(subtitlePositionRange.max, settings.subtitlePosition + delta),
    );
    if (next !== settings.subtitlePosition) {
      onSettingsChange({ ...settings, subtitlePosition: next });
    }
  };

  useEffect(() => {
    if (!nativeShell) return;
    let disposed = false;
    void connectNativePlayer()
      .then((player) => {
        if (!disposed) setNativePlayer(player);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        reportFailure(enUS.player.connectionFailed, {
          code: error instanceof Error ? error.message : 'UnknownError',
        });
      });
    return () => {
      disposed = true;
    };
  }, [nativeShell, reportFailure]);

  useEffect(() => {
    if (result.loading) return;
    if (result.error) {
      reportFailure(enUS.player.prepareFailed);
    } else if (result.state?.stream?.type === 'Err') {
      reportFailure(enUS.player.resolveFailed);
    }
  }, [reportFailure, result.error, result.loading, result.state]);

  useEffect(() => {
    if (!subtitleMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!subtitleMenuRef.current?.contains(event.target as Node)) setSubtitleMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSubtitleMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    // Opening moves focus to the current choice, so the keyboard lands inside
    // the panel. Closing returns it to the button when it was inside.
    const panel = subtitleMenuRef.current;
    const toggle = subtitleButtonRef.current;
    const current =
      panel?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
      panel?.querySelector<HTMLButtonElement>('button');
    current?.focus();
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) {
        toggle?.focus();
      }
    };
  }, [subtitleMenuOpen]);

  useEffect(() => {
    if (!nativePlayer || !streamUrl) return;
    audioAutoDoneRef.current = false;
    subtitleAutoDoneRef.current = false;
    subtitleFallbackDoneRef.current = false;
    nativeLoadReadyRef.current = false;
    trackChoicesRef.current = loadTitleTrackChoices({
      id: selection.meta.id,
      type: selection.meta.type,
    });
    addedAddonSubtitlesRef.current = new Map();
    addonSubtitlesByTokenRef.current = new Map();
    let starting = true;
    closingRef.current = false;
    videoParamsReportedRef.current = false;
    let availableAudio: AudioTrack[] = [];
    let availableSubtitles: SubtitleTrack[] = [];
    const restoreTracks = () => {
      // Switching tracks while mpv initializes its decoders can prevent the
      // first frame from arriving. Apply overrides after playback is ready.
      if (!nativeLoadReadyRef.current) return;
      if (!audioAutoDoneRef.current && availableAudio.length > 0) {
        audioAutoDoneRef.current = true;
        const track = rememberedTrack(availableAudio, trackChoicesRef.current.audio);
        if (track) nativePlayer.setAudioTrack(track.id);
      }
      if (subtitleAutoDoneRef.current) return;
      const choice = trackChoicesRef.current.subtitle;
      if (choice?.kind === 'off') {
        subtitleAutoDoneRef.current = true;
        nativePlayer.setSubtitleTrack(0);
      } else if (availableSubtitles.length > 0 && !subtitleFallbackDoneRef.current) {
        subtitleFallbackDoneRef.current = true;
        // Add-on snapshots may arrive later. Keep their restoration pending
        // while using the ordinary embedded subtitle defaults.
        subtitleAutoDoneRef.current = choice?.kind !== 'addon';
        const remembered = rememberedTrack(
          availableSubtitles,
          choice?.kind === 'track' ? choice : undefined,
        );
        const defaults = subtitleDefaults();
        const track =
          remembered ??
          (defaults.enabled ? preferredSubtitleTrack(availableSubtitles, defaults.language) : null);
        if (track) nativePlayer.setSubtitleTrack(track.id);
      }
    };
    const onEvent = (name: string, payload: Record<string, unknown>) => {
      if (closingRef.current) return;
      if (name === 'time' && typeof payload.milliseconds === 'number') {
        const nextTime = payload.milliseconds;
        updateTime(nextTime);
        if (nextTime - lastProgressRef.current >= 5_000 || nextTime < lastProgressRef.current) {
          lastProgressRef.current = nextTime;
          reportProgress();
        }
      } else if (name === 'duration' && typeof payload.milliseconds === 'number') {
        updateDuration(payload.milliseconds);
      } else if (name === 'paused' && typeof payload.paused === 'boolean') {
        setPaused(payload.paused);
        if (!payload.paused) setEnded(false);
        dispatchPlayer('PausedChanged', { paused: payload.paused });
      } else if (name === 'muted' && typeof payload.muted === 'boolean') {
        setMuted(payload.muted);
      } else if (
        name === 'volume' &&
        typeof payload.percent === 'number' &&
        Number.isFinite(payload.percent)
      ) {
        setVolume(Math.max(0, Math.min(100, payload.percent)));
      } else if (name === 'buffering' && typeof payload.active === 'boolean') {
        if (starting) {
          starting = false;
          setAddedSubtitleUrls(new Set());
        }
        setBuffering(payload.active);
      } else if (name === 'ready') {
        nativeLoadReadyRef.current = true;
        restoreTracks();
        setNativeReadyVersion((version) => version + 1);
        setBuffering(false);
        reportMediaReady();
      } else if (name === 'chapters') {
        setChapterCues(nativeChapterCues(payload.items));
      } else if (name === 'audioTracks') {
        availableAudio = parseAudioTracks(payload.items);
        setAudioTracks(availableAudio);
        restoreTracks();
      } else if (name === 'subtitleTracks') {
        const tracks = parseSubtitleTracks(payload.items).map((track) => {
          const subtitle = track.external
            ? addonSubtitlesByTokenRef.current.get(track.title ?? '')
            : undefined;
          if (!subtitle) return track;
          addedAddonSubtitlesRef.current.set(track.id, subtitle);
          return { ...track, title: addonSubtitleLabel(subtitle) };
        });
        availableSubtitles = tracks;
        setSubtitleTracks(tracks);
        restoreTracks();
      } else if (name === 'error') {
        setBuffering(false);
        setPaused(true);
        reportFailure(nativeErrorMessage(payload.code), { code: payload.code });
      } else if (name === 'ended') {
        setBuffering(false);
        setPaused(true);
        setEnded(true);
        reportProgress();
        dispatchPlayer('Ended');
      }
    };

    nativePlayer.playerEvent.connect(onEvent);
    if (nativePlayer.loadWithAudioLanguage) {
      nativePlayer.loadWithAudioLanguage(
        streamUrl,
        settings.audioOutput === 'stereo',
        requestHeaders,
        preferredAudioLanguage ?? '',
      );
    } else {
      nativePlayer.load(streamUrl, settings.audioOutput === 'stereo', requestHeaders);
    }

    return () => {
      nativePlayer.playerEvent.disconnect(onEvent);
      if (!closingRef.current) nativePlayer.stop();
    };
  }, [
    dispatchPlayer,
    nativePlayer,
    reportFailure,
    reportMediaReady,
    reportProgress,
    requestHeaders,
    setChapterCues,
    settings.audioOutput,
    preferredAudioLanguage,
    selection.meta.id,
    selection.meta.type,
    streamUrl,
    updateDuration,
    updateTime,
  ]);

  useEffect(() => {
    if (!nativePlayer) return;
    nativePlayer.setSubtitleScale(settings.subtitleSize / 100);
    nativePlayer.setSubtitlePosition(settings.subtitlePosition);
  }, [nativePlayer, settings.subtitlePosition, settings.subtitleSize]);

  useEffect(() => {
    if (!nativePlayer) return;
    nativePlayer.setNowPlayingMetadata(
      result.state?.title ?? selection.meta.name,
      selection.video?.title ?? selection.meta.name,
    );
  }, [nativePlayer, result.state?.title, selection]);

  useEffect(() => {
    if (!nativePlayer || subtitleAutoDoneRef.current || !streamUrl || !nativeLoadReadyRef.current)
      return;
    const choice = trackChoicesRef.current.subtitle;
    if (choice?.kind !== 'addon') return;
    const subtitle = rememberedAddonSubtitle(addonSubtitles, choice);
    if (!subtitle) return;
    subtitleAutoDoneRef.current = true;
    setAddedSubtitleUrls((previous) => new Set(previous).add(subtitle.url));
    attachAddonSubtitle(subtitle);
  }, [nativePlayer, addonSubtitles, streamUrl, nativeReadyVersion, attachAddonSubtitle]);

  useEffect(() => {
    if (resumeAppliedRef.current || duration <= 0 || resumeTime <= 0 || resumeTime >= duration)
      return;
    const timeout = window.setTimeout(() => {
      resumeAppliedRef.current = true;
      seekTo(resumeTime);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [duration, resumeTime, seekTo]);

  return (
    <div
      className={`${styles.player} ${nativeShell ? styles.nativePlayer : ''} ${controlsVisible ? '' : styles.controlsHidden}`}
      ref={containerRef}
    >
      {streamUrl && !nativeShell ? (
        <video
          autoPlay
          onCanPlay={() => setBuffering(false)}
          onDurationChange={(event) => updateDuration(event.currentTarget.duration * 1000)}
          onEnded={() => {
            setBuffering(false);
            setPaused(true);
            setEnded(true);
            dispatchPlayer('Ended');
          }}
          onError={(event) => {
            const video = event.currentTarget;
            setBuffering(false);
            reportFailure(enUS.player.playbackFailed, {
              code: video.error?.code ?? 0,
              networkState: video.networkState,
              readyState: video.readyState,
            });
          }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            updateDuration(video.duration * 1000);
            setPaused(video.paused);
            reportMediaReady();
          }}
          onLoadStart={() => {
            videoParamsReportedRef.current = false;
            setBuffering(true);
          }}
          onPause={() => {
            setPaused(true);
            dispatchPlayer('PausedChanged', { paused: true });
            reportProgress();
          }}
          onPlay={() => {
            setEnded(false);
            setPaused(false);
            dispatchPlayer('PausedChanged', { paused: false });
          }}
          onPlaying={() => setBuffering(false)}
          onSeeking={(event) => {
            setEnded(false);
            updateTime(event.currentTarget.currentTime * 1000);
          }}
          onSeeked={() => reportProgress(true)}
          onStalled={() => setBuffering(true)}
          onTimeUpdate={(event) => {
            const nextTime = event.currentTarget.currentTime * 1000;
            updateTime(nextTime);
            if (nextTime - lastProgressRef.current >= 5_000 || nextTime < lastProgressRef.current) {
              lastProgressRef.current = nextTime;
              reportProgress();
            }
          }}
          playsInline
          ref={videoRef}
          src={streamUrl}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume * 100);
            setMuted(event.currentTarget.muted);
          }}
          onWaiting={() => setBuffering(true)}
        />
      ) : null}

      {streamUrl ? (
        // A click on the picture plays or pauses, and a double click toggles
        // fullscreen. Its two clicks cancel out, as in other players.
        <div
          aria-hidden
          className={styles.playerSurface}
          onClick={togglePlayback}
          onDoubleClick={toggleFullscreen}
        />
      ) : null}

      <div className={styles.playerTopbar} ref={topbarRef}>
        <button onClick={() => finishPlayback(onBack)} type="button">
          <ArrowLeft aria-hidden size={18} />
          {enUS.player.backToSources}
        </button>
        <div>
          <strong>{result.state?.title ?? selection.meta.name}</strong>
          <span>
            {selection.video?.title ?? selection.stream.name ?? enUS.player.selectedSource}
          </span>
        </div>
      </div>

      <div aria-live="polite">
        {shutdownError ? (
          <div className={styles.playerStatus} role="alert">
            {shutdownError}
          </div>
        ) : saving ? (
          <div className={styles.playerStatus}>{enUS.player.savingProgress}</div>
        ) : null}
        {result.loading ? (
          <div className={styles.playerStatus}>{enUS.player.preparingSource}</div>
        ) : null}
        {nativeShell && !nativePlayer ? (
          <div className={styles.playerStatus}>{enUS.player.preparingNative}</div>
        ) : null}
        {torrent && nativePlayer && !streamUrl ? (
          <div className={styles.playerStatus}>{enUS.player.preparingTorrent}</div>
        ) : null}
        {streamUrl && buffering ? (
          <div className={styles.playerStatus}>{enUS.player.buffering}</div>
        ) : null}
      </div>

      {settings.skipIntroButton &&
      intro.insideIntro &&
      (!settings.automaticIntroSkipping || intro.automaticSkipComplete) ? (
        <button className={styles.skipIntro} onClick={intro.skip} type="button">
          {enUS.player.skipIntro}
          <SkipForward aria-hidden size={16} weight="fill" />
        </button>
      ) : null}

      {(ended || nearEnd) && settings.upNext && selection.nextVideo ? (
        <div className={styles.upNext} role="status">
          <span className={styles.upNextLabel}>{enUS.player.upNext}</span>
          <strong>
            {selection.nextVideo.title || enUS.details.episode(selection.nextVideo.episode)}
          </strong>
          <button
            onClick={() => {
              const next = selection.nextVideo;
              if (next) finishPlayback(() => onUpNext(next));
            }}
            type="button"
          >
            {enUS.player.chooseSource}
          </button>
        </div>
      ) : null}

      {intro.automaticNotice && marker ? (
        <div className={styles.skipNotice} role="status">
          <span>{enUS.player.introSkipped}</span>
          <button onClick={intro.undoAutomaticSkip} type="button">
            {enUS.player.undo}
          </button>
        </div>
      ) : null}

      {streamUrl ? (
        <div className={styles.playerControls} ref={controlsRef}>
          {subtitleMenuOpen && nativePlayer ? (
            <SubtitlePanel
              addonSubtitles={addonSubtitles.filter(
                (subtitle) => !addedSubtitleUrls.has(subtitle.url),
              )}
              delayMs={subtitleDelayMs}
              onAddAddon={addAddonSubtitle}
              onDelay={changeSubtitleDelay}
              onPosition={changeSubtitlePosition}
              onSelect={selectSubtitleTrack}
              onSize={changeSubtitleSize}
              panelRef={subtitleMenuRef}
              position={settings.subtitlePosition}
              selectedId={selectedSubtitleId}
              size={settings.subtitleSize}
              tracks={subtitleTracks}
            />
          ) : null}
          {fullscreenError ? (
            <div className={styles.fullscreenError} role="alert">
              {fullscreenError}
            </div>
          ) : null}
          <div
            className={styles.timeline}
            onPointerLeave={() => setHoverRatio(null)}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (bounds.width <= 0 || duration <= 0) return;
              setHoverRatio(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
            }}
          >
            {hoverRatio !== null && duration > 0 ? (
              <span
                aria-hidden
                className={styles.timelineHover}
                style={{ left: `${hoverRatio * 100}%` }}
              >
                {formatTime(hoverRatio * duration)}
              </span>
            ) : null}
            {intro.markerStyle ? (
              <span className={styles.introRange} style={intro.markerStyle} />
            ) : null}
            <input
              aria-label={enUS.player.playbackPosition}
              max={duration || 1}
              min={0}
              onChange={(event) => {
                seekTo(Number(event.target.value));
                reportProgress(true);
              }}
              step={1000}
              type="range"
              value={Math.min(time, duration || 1)}
            />
          </div>
          <div className={styles.controlRow}>
            <button
              aria-label={paused ? enUS.player.play : enUS.player.pause}
              onClick={togglePlayback}
              type="button"
            >
              {paused ? (
                <Play aria-hidden size={20} weight="fill" />
              ) : (
                <Pause aria-hidden size={20} weight="fill" />
              )}
            </button>
            <button
              aria-label={muted ? enUS.player.unmute : enUS.player.mute}
              onClick={toggleMuted}
              type="button"
            >
              {muted || volume === 0 ? (
                <SpeakerSlash aria-hidden size={20} />
              ) : (
                <SpeakerHigh aria-hidden size={20} />
              )}
            </button>
            <input
              aria-label={enUS.player.volume}
              aria-valuetext={enUS.format.percent(Math.round(volume))}
              className={styles.volumeSlider}
              min={0}
              max={100}
              step={1}
              type="range"
              value={volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
            />
            <span className={styles.timeLabel}>
              {formatTime(time)} / {formatTime(duration)}
            </span>
            {nativePlayer ? (
              <AudioTrackPicker
                open={audioMenuOpen}
                onOpenChange={changeAudioMenu}
                onSelect={(id) => {
                  audioAutoDoneRef.current = true;
                  const track = audioTracks.find((candidate) => candidate.id === id);
                  if (track)
                    saveTitleTrackChoice(selection.meta, {
                      audio: describeTrack(track, audioTracks),
                    });
                  nativePlayer.setAudioTrack(id);
                }}
                tracks={audioTracks}
              />
            ) : null}
            {nativePlayer ? (
              <button
                aria-expanded={subtitleMenuOpen}
                aria-label={enUS.player.subtitles}
                ref={subtitleButtonRef}
                className={subtitleMenuOpen ? styles.controlActive : undefined}
                onClick={() => {
                  setAudioMenuOpen(false);
                  setSubtitleMenuOpen((open) => !open);
                }}
                type="button"
              >
                <Subtitles aria-hidden size={20} />
              </button>
            ) : null}
            <button
              aria-label={fullscreen ? enUS.player.exitFullscreen : enUS.player.enterFullscreen}
              onClick={toggleFullscreen}
              type="button"
            >
              {fullscreen ? (
                <ArrowsIn aria-hidden size={20} />
              ) : (
                <ArrowsOut aria-hidden size={20} />
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
