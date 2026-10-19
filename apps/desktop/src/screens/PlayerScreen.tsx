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

import styles from '../styles/player.module.css';
import { AudioTrackPicker } from '../components/AudioTrackPicker';
import { SubtitlePanel } from '../components/SubtitlePanel';
import type { AudioTrack } from '../player/audio';
import {
  describeAddonSubtitle,
  describeTrack,
  loadTitleTrackChoices,
  rememberedAddonSubtitle,
  rememberedTrack,
  saveTitleTrackChoice,
  type TitleTrackChoices,
} from '../player/trackChoices';
import { finalPauseAction, loadPlayerAction, type PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreVideo } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import {
  connectNativePlayer,
  nativeShellPresent,
  playbackDevice,
  type NativePlayer,
} from '../native/player';
import { formatTime } from '../player/nativeEvents';
import {
  addonSubtitleLabel,
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
import { mediaFailureMessage } from '../playback/failures';
import type { MediaBackend, MediaEvent } from '../playback/media';
import { mpvBackend } from '../playback/mpvBackend';
import {
  createProgressReporter,
  timeChangedAction,
  type ProgressReporter,
} from '../playback/progress';
import { videoBackend } from '../playback/videoBackend';

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
  const progressRef = useRef<ProgressReporter | null>(null);
  const resumeAppliedRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(settings.volume);
  const [buffering, setBuffering] = useState(false);
  const [nativePlayer, setNativePlayer] = useState<NativePlayer | null>(null);
  const nativeShell = nativeShellPresent();
  const nativeBackend = useMemo(
    () => (nativePlayer ? mpvBackend(nativePlayer) : null),
    [nativePlayer],
  );
  const browserBackend = useMemo(() => (nativeShell ? null : videoBackend()), [nativeShell]);
  const backend: MediaBackend | null = nativeBackend ?? browserBackend;
  const trackBackend = backend?.capabilities.tracks ? backend : null;
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;
      // useIntroSkip still reads the element to know a player exists.
      videoRef.current = video;
      const detach = browserBackend?.attach(video);
      return () => {
        videoRef.current = null;
        detach?.();
      };
    },
    [browserBackend],
  );
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
  const mediaReadyRef = useRef(false);
  const [mediaReadyVersion, setMediaReadyVersion] = useState(0);
  // What the current load has reported, for the track restoration.
  const loadRef = useRef({
    starting: true,
    audio: [] as AudioTrack[],
    subtitles: [] as SubtitleTrack[],
  });
  const trackChoicesRef = useRef<TitleTrackChoices>({});
  const addedAddonSubtitlesRef = useRef(new Map<number, AddonSubtitle>());
  const addonSubtitlesByTokenRef = useRef(new Map<string, AddonSubtitle>());
  const refreshRatePreference = useEffectEvent(() => settings.matchRefreshRate);
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
  const addonSubtitles = useMemo(() => result.state?.subtitles ?? [], [result.state?.subtitles]);
  const selectedSubtitleId = subtitleTracks.find((track) => track.selected)?.id ?? null;
  const nearEnd =
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(time) &&
    time >= duration - Math.min(120_000, duration * 0.1);

  const updateTime = useCallback((milliseconds: number) => {
    if (milliseconds < playbackRef.current.time) setEnded(false);
    playbackRef.current.time = milliseconds;
    setTime(milliseconds);
  }, []);

  // Callers pair every seek with this, so Core can move a stored offset backwards.
  const reportSeek = useCallback(() => {
    if (!closingRef.current) progressRef.current?.seek(playbackRef.current);
  }, []);

  async function saveBeforeUnload(target: CoreTransport, loaded: Promise<void>) {
    closingRef.current = true;
    setPaused(true);
    setShutdownError(null);
    try {
      const frozen = await backend?.freeze();
      if (frozen) playbackRef.current = frozen;
      await loaded.catch(() => undefined);
      const finalTime = timeChangedAction(playbackRef.current, playbackDevice());
      if (finalTime) await target.dispatch(finalTime, 'player');
      await target.commit(finalPauseAction, 'player');
      backend?.stop();
    } catch (error) {
      closingRef.current = false;
      setShutdownError(enUS.player.saveFailed);
      throw error;
    }
  }

  const unloadPlayer = result.unload;
  const [saving, setSaving] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [bufferedTime, setBufferedTime] = useState(0);
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

  // Core hears the change from the player's own pause event, not from here.
  const togglePlayback = useCallback(() => {
    if (closingRef.current || !backend) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    backend.setPaused(nextPaused);
  }, [backend, paused]);

  const seekTo = useCallback(
    (milliseconds: number) => {
      if (closingRef.current) return;
      setEnded(false);
      const safeTime = Math.max(0, milliseconds);
      updateTime(safeTime);
      backend?.seek(safeTime);
    },
    [backend, updateTime],
  );

  const changeVolume = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent)) return;
      const next = Math.max(0, Math.min(100, percent));
      setVolume(next);
      onSettingsChange({ ...settings, volume: next });
      if (next > 0 && muted) {
        setMuted(false);
        backend?.setMuted(false);
      }
    },
    [backend, muted, onSettingsChange, settings],
  );

  useEffect(() => {
    backend?.setVolume(settings.volume);
  }, [backend, settings.volume, streamUrl]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    backend?.setMuted(nextMuted);
  }, [backend, muted]);

  const intro = useIntroSkip({
    automatic: settings.automaticIntroSkipping,
    duration,
    nativePlayer,
    reportProgress: reportSeek,
    seekTo,
    selection,
    time,
    videoRef,
  });
  const { marker, setChapterCues } = intro;

  const currentTime = useCallback(() => playbackRef.current.time, []);
  const hasPlayer = useCallback(() => Boolean(backend && streamUrl), [backend, streamUrl]);
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
    if (!trackBackend) return;
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
    trackBackend.setSubtitleTrack(id);
    if (settings.subtitles !== (id !== null)) {
      onSettingsChange({ ...settings, subtitles: id !== null });
    }
  };

  const attachAddonSubtitle = useCallback(
    (subtitle: AddonSubtitle) => {
      if (!trackBackend) return;
      // mpv reports the supplied title but no add-request ID. An opaque title
      // correlates each result even when another same-language download fails.
      // Track snapshots replace it with the normal display label below.
      const token = crypto.randomUUID();
      addonSubtitlesByTokenRef.current.set(token, subtitle);
      trackBackend.addSubtitles(subtitle.url, token, subtitle.lang);
    },
    [trackBackend],
  );

  const addAddonSubtitle = (subtitle: AddonSubtitle) => {
    if (!trackBackend || addedSubtitleUrls.has(subtitle.url)) return;
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
    trackBackend?.setSubtitleDelay(next);
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

  // Called from onMedia only. Switching tracks while mpv initializes its
  // decoders can prevent the first frame from arriving, so overrides wait
  // until playback is ready.
  const restoreTracks = (target: MediaBackend) => {
    if (!mediaReadyRef.current) return;
    const { audio, subtitles } = loadRef.current;
    if (!audioAutoDoneRef.current && audio.length > 0) {
      audioAutoDoneRef.current = true;
      const track = rememberedTrack(audio, trackChoicesRef.current.audio);
      if (track) target.setAudioTrack(track.id);
    }
    if (subtitleAutoDoneRef.current) return;
    const choice = trackChoicesRef.current.subtitle;
    if (choice?.kind === 'off') {
      subtitleAutoDoneRef.current = true;
      target.setSubtitleTrack(null);
    } else if (subtitles.length > 0 && !subtitleFallbackDoneRef.current) {
      subtitleFallbackDoneRef.current = true;
      // Add-on snapshots may arrive later. Keep their restoration pending
      // while using the ordinary embedded subtitle defaults.
      subtitleAutoDoneRef.current = choice?.kind !== 'addon';
      const remembered = rememberedTrack(subtitles, choice?.kind === 'track' ? choice : undefined);
      const track =
        remembered ??
        (settings.subtitles ? preferredSubtitleTrack(subtitles, preferredSubtitleLanguage) : null);
      if (track) target.setSubtitleTrack(track.id);
    }
  };

  // Both backends' events arrive here already parsed, so progress, pause and
  // end are handled once whichever player produced them.
  const onMedia = useEffectEvent((event: MediaEvent, source: MediaBackend) => {
    if (closingRef.current) return;
    const progress = progressRef.current;
    switch (event.type) {
      case 'time':
        updateTime(event.milliseconds);
        progress?.time(playbackRef.current);
        break;
      case 'duration':
        playbackRef.current.duration = event.milliseconds;
        setDuration(event.milliseconds);
        break;
      case 'buffered':
        setBufferedTime(event.milliseconds);
        break;
      case 'paused':
        setPaused(event.paused);
        if (!event.paused) setEnded(false);
        progress?.paused(event.paused, playbackRef.current);
        break;
      case 'buffering':
        if (loadRef.current.starting) {
          loadRef.current.starting = false;
          setAddedSubtitleUrls(new Set());
        }
        setBuffering(event.active);
        break;
      case 'ready':
        mediaReadyRef.current = true;
        if (event.paused !== undefined) setPaused(event.paused);
        restoreTracks(source);
        setMediaReadyVersion((version) => version + 1);
        progress?.mediaReady(videoParams(selection.stream));
        break;
      case 'ended':
        setBuffering(false);
        setPaused(true);
        setEnded(true);
        progress?.ended(playbackRef.current);
        break;
      case 'volume':
        setVolume(event.percent);
        break;
      case 'muted':
        setMuted(event.muted);
        break;
      case 'chapters':
        setChapterCues(event.cues);
        break;
      case 'audioTracks':
        loadRef.current.audio = event.tracks;
        setAudioTracks(event.tracks);
        restoreTracks(source);
        break;
      case 'subtitleTracks': {
        const tracks = event.tracks.map((track) => {
          const subtitle = track.external
            ? addonSubtitlesByTokenRef.current.get(track.title ?? '')
            : undefined;
          if (!subtitle) return track;
          addedAddonSubtitlesRef.current.set(track.id, subtitle);
          return { ...track, title: addonSubtitleLabel(subtitle) };
        });
        loadRef.current.subtitles = tracks;
        setSubtitleTracks(tracks);
        restoreTracks(source);
        break;
      }
      case 'failed':
        setBuffering(false);
        setPaused(true);
        reportFailure(mediaFailureMessage(event.failure), event.detail);
        break;
    }
  });

  useEffect(() => {
    if (!backend || !streamUrl) return;
    audioAutoDoneRef.current = false;
    subtitleAutoDoneRef.current = false;
    subtitleFallbackDoneRef.current = false;
    mediaReadyRef.current = false;
    loadRef.current = { starting: true, audio: [], subtitles: [] };
    trackChoicesRef.current = loadTitleTrackChoices({
      id: selection.meta.id,
      type: selection.meta.type,
    });
    addedAddonSubtitlesRef.current = new Map();
    addonSubtitlesByTokenRef.current = new Map();
    closingRef.current = false;
    progressRef.current = transport ? createProgressReporter(transport, playbackDevice()) : null;
    const unsubscribe = backend.subscribe((event) => onMedia(event, backend));
    backend.load({
      url: streamUrl,
      headers: requestHeaders,
      stereo: settings.audioOutput === 'stereo',
      audioLanguage: preferredAudioLanguage ?? '',
      matchRefreshRate: refreshRatePreference(),
    });
    return () => {
      unsubscribe();
      if (!closingRef.current) backend.stop();
    };
  }, [
    backend,
    preferredAudioLanguage,
    requestHeaders,
    selection.meta.id,
    selection.meta.type,
    settings.audioOutput,
    streamUrl,
    transport,
  ]);

  // `load` sends the value a source opens with; this sends later changes.
  useEffect(() => {
    backend?.setMatchRefreshRate(settings.matchRefreshRate);
  }, [backend, settings.matchRefreshRate]);

  useEffect(() => {
    backend?.setSubtitleStyle({ size: settings.subtitleSize, position: settings.subtitlePosition });
  }, [backend, settings.subtitlePosition, settings.subtitleSize]);

  useEffect(() => {
    backend?.setNowPlaying(
      result.state?.title ?? selection.meta.name,
      selection.video?.title ?? selection.meta.name,
    );
  }, [backend, result.state?.title, selection]);

  useEffect(() => {
    if (!trackBackend || subtitleAutoDoneRef.current || !streamUrl || !mediaReadyRef.current)
      return;
    const choice = trackChoicesRef.current.subtitle;
    if (choice?.kind !== 'addon') return;
    const subtitle = rememberedAddonSubtitle(addonSubtitles, choice);
    if (!subtitle) return;
    subtitleAutoDoneRef.current = true;
    setAddedSubtitleUrls((previous) => new Set(previous).add(subtitle.url));
    attachAddonSubtitle(subtitle);
  }, [trackBackend, addonSubtitles, streamUrl, mediaReadyVersion, attachAddonSubtitle]);

  useEffect(() => {
    if (resumeAppliedRef.current || duration <= 0 || resumeTime <= 0 || resumeTime >= duration)
      return;
    const timeout = window.setTimeout(() => {
      resumeAppliedRef.current = true;
      seekTo(resumeTime);
      reportSeek();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [duration, reportSeek, resumeTime, seekTo]);

  return (
    <div
      className={`${styles.player} ${nativeShell ? styles.nativePlayer : ''} ${controlsVisible ? '' : styles.controlsHidden}`}
      ref={containerRef}
    >
      {streamUrl && browserBackend ? <video autoPlay playsInline ref={attachVideo} /> : null}

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
          {subtitleMenuOpen && trackBackend ? (
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
            {duration > 0 && bufferedTime > time ? (
              <span
                aria-hidden
                className={styles.bufferedRange}
                style={{ width: `${Math.min(100, (bufferedTime / duration) * 100)}%` }}
              />
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
                reportSeek();
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
            {trackBackend ? (
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
                  trackBackend.setAudioTrack(id);
                }}
                tracks={audioTracks}
              />
            ) : null}
            {trackBackend ? (
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
