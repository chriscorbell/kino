import {
  ArrowLeft,
  ArrowsIn,
  ArrowsOut,
  Minus,
  Pause,
  Play,
  Plus,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  Subtitles,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { loadPlayerAction, playerAction, type PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreVideo } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import {
  lookupCommunityIntro,
  markerFromChapterCues,
  type ChapterCue,
  type IntroMarker,
} from '../intro/markers';
import { t as enUS } from '../locales';
import { connectNativePlayer, nativeShellPresent, type NativePlayer } from '../native/player';
import {
  addonSubtitleLabel,
  labelAddonSubtitles,
  parseSubtitleTracks,
  preferredSubtitleTrack,
  labelSubtitleTracks,
  type AddonSubtitle,
  type SubtitleTrack,
} from '../player/subtitles';
import {
  resolveFileIndex,
  torrentCreateRequest,
  torrentMediaUrl,
  type TorrentSource,
  type TorrentStats,
} from '../player/torrent';
import { subtitlePositionRange, subtitleSizeRange, type KinoSettings } from '../settings';
import { videoParams } from '../player/videoParams';
import { useFullscreen } from '../player/useFullscreen';
import { useIdleControls } from '../player/useIdleControls';

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const padded = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${padded(minutes)}:${padded(remainder)}`
    : `${minutes}:${padded(remainder)}`;
}

function introIdentity(selection: PlaybackSelection, durationMs: number) {
  const imdbId = /^tt\d+$/.test(selection.meta.id) ? selection.meta.id : null;
  const { episode = null, season = null } = selection.video ?? {};
  return {
    durationMs,
    ...(episode === null ? {} : { episode }),
    ...(imdbId === null ? {} : { imdbId }),
    ...(season === null ? {} : { season }),
  };
}

function nativeErrorMessage(code: unknown) {
  if (code === 'hardware-decoding-unavailable') {
    return 'This source could not be hardware-decoded on this Mac.';
  }
  if (code === 'render-context-unavailable') {
    return 'Kino could not start the native video renderer.';
  }
  return 'The native player could not decode or load this source.';
}

function nativeChapterCues(value: unknown): ChapterCue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ChapterCue[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const { startMs, title } = candidate as Record<string, unknown>;
    return typeof startMs === 'number' && Number.isFinite(startMs) && typeof title === 'string'
      ? [{ startMs, title }]
      : [];
  });
}

function AdjustRow({
  label,
  onDecrease,
  onIncrease,
  value,
}: {
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
  value: string;
}) {
  return (
    <div className={styles.subtitleAdjustRow}>
      <span>{label}</span>
      <span className={styles.subtitleAdjustControls}>
        <button aria-label={`${enUS.player.decrease} ${label}`} onClick={onDecrease} type="button">
          <Minus aria-hidden size={14} />
        </button>
        <span className={styles.subtitleAdjustValue}>{value}</span>
        <button aria-label={`${enUS.player.increase} ${label}`} onClick={onIncrease} type="button">
          <Plus aria-hidden size={14} />
        </button>
      </span>
    </div>
  );
}

export function PlayerScreen({
  onBack,
  onSettingsChange,
  onSourceFailure,
  onUpNext,
  preferredSubtitleLanguage,
  selection,
  settings,
}: {
  onBack: () => void;
  onSettingsChange: (settings: KinoSettings) => void;
  onSourceFailure: (message: string) => void;
  onUpNext: (video: CoreVideo) => void;
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
  const autoSkipSuppressedRef = useRef(false);
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
  const [chapterCues, setChapterCues] = useState<ChapterCue[]>([]);
  const [communityMarker, setCommunityMarker] = useState<IntroMarker | null>(null);
  const [automaticSkipComplete, setAutomaticSkipComplete] = useState(false);
  const [automaticNotice, setAutomaticNotice] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const subtitleMenuRef = useRef<HTMLDivElement>(null);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [addedSubtitleUrls, setAddedSubtitleUrls] = useState<ReadonlySet<string>>(new Set());
  const failureReportedRef = useRef(false);
  const subtitleAutoDoneRef = useRef(false);
  const videoParamsReportedRef = useRef(false);
  const [ended, setEnded] = useState(false);
  const [torrentUrl, setTorrentUrl] = useState<string | null>(null);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const result = useCoreModel(
    'player',
    loadPlayerAction(selection),
    `${selection.meta.id}:${selection.video?.id ?? 'movie'}:${selection.streamTransportUrl}`,
    { beforeUnload: (target, loaded) => saveBeforeUnload(target, loaded) },
  );
  const resolved = result.state?.stream?.type === 'Ready' ? result.state.stream.content : null;
  const resolvedTorrent = resolved?.source.kind === 'torrent' ? resolved.source : null;
  // Every Player snapshot rebuilds the adapted stream, so a progress or subtitle
  // update would hand the effects below a new object for the same torrent and
  // restart the streaming engine mid-transfer. Hold it steady by its own value.
  // The adapter already checked these fields and keeps each peer hint verbatim,
  // so the key has to be lossless: a hint may contain any characters, and
  // splitting one apart would invent a tracker the add-on never offered.
  const torrentKey = resolvedTorrent === null ? null : JSON.stringify(resolvedTorrent);
  const torrent = useMemo<TorrentSource | null>(
    () => (torrentKey === null ? null : (JSON.parse(torrentKey) as TorrentSource)),
    [torrentKey],
  );
  // Core wraps direct streams with proxy headers in a URL for the account's
  // Stremio Service. The native backend can send those headers itself, using
  // the original source URL independently of that service's address.
  const chosen = selection.stream.source;
  const directUrl = chosen.kind === 'url' && chosen.url.startsWith('https://') ? chosen.url : null;
  const streamUrl = resolved
    ? torrent
      ? torrentUrl
      : (directUrl ?? (resolved.source.kind === 'url' ? resolved.source.url : null))
    : null;
  const requestHeaders = useMemo(
    () => (directUrl ? (selection.stream.hints.proxyRequestHeaders ?? {}) : {}),
    [directUrl, selection.stream],
  );
  const resumeTime = result.state?.libraryItem?.timeOffset ?? 0;
  const nativeShell = nativeShellPresent();
  const controlsVisible = useIdleControls(
    topbarRef,
    controlsRef,
    paused ||
      buffering ||
      subtitleMenuOpen ||
      result.loading ||
      !streamUrl ||
      Boolean(shutdownError || fullscreenError),
  );
  const addonSubtitles = result.state?.subtitles ?? [];
  const selectedSubtitleId = subtitleTracks.find((track) => track.selected)?.id ?? null;
  const chapterMarker = useMemo(
    () => markerFromChapterCues(chapterCues, duration),
    [chapterCues, duration],
  );
  const marker = chapterMarker ?? communityMarker;
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
  const finishPlayback = useCallback(
    (navigate: () => void) => {
      if (navigationPendingRef.current) return;
      navigationPendingRef.current = true;
      void unloadPlayer()
        .then(navigate)
        .catch(() => {
          navigationPendingRef.current = false;
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
      reportFailure('Playback could not start with this source.', {
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

  const selectSubtitleTrack = (id: number | null) => {
    if (!nativePlayer) return;
    subtitleAutoDoneRef.current = true;
    nativePlayer.setSubtitleTrack(id ?? 0);
    if (settings.subtitles !== (id !== null)) {
      onSettingsChange({ ...settings, subtitles: id !== null });
    }
  };

  const addAddonSubtitle = (subtitle: AddonSubtitle) => {
    if (!nativePlayer || addedSubtitleUrls.has(subtitle.url)) return;
    subtitleAutoDoneRef.current = true;
    setAddedSubtitleUrls((previous) => new Set(previous).add(subtitle.url));
    nativePlayer.addSubtitles(subtitle.url, addonSubtitleLabel(subtitle), subtitle.lang);
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
        reportFailure('Kino could not connect to the native player.', {
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
      reportFailure('The source could not be prepared.');
    } else if (result.state?.stream?.type === 'Err') {
      reportFailure('The add-on could not resolve this source.');
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
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [subtitleMenuOpen]);

  useEffect(() => {
    if (!torrent || !nativePlayer) return;
    const onEngine = (url: string, error: string) => {
      if (error) {
        reportFailure(error);
      } else if (url) {
        setEngineUrl(url);
      }
    };
    nativePlayer.streamingEngineChanged.connect(onEngine);
    nativePlayer.startStreamingEngine();
    return () => nativePlayer.streamingEngineChanged.disconnect(onEngine);
  }, [nativePlayer, reportFailure, torrent]);

  useEffect(() => {
    if (!torrent || !engineUrl || torrentUrl) return;
    const controller = new AbortController();
    const request = torrentCreateRequest(engineUrl, torrent);

    void fetch(request.createUrl, {
      body: JSON.stringify(request.body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Engine returned ${response.status}.`);
        const stats = (await response.json()) as TorrentStats;
        const fileIndex = resolveFileIndex(torrent, stats);
        if (fileIndex === null) {
          throw new Error('The engine could not identify a playable file.');
        }
        setTorrentUrl(torrentMediaUrl(engineUrl, torrent, fileIndex));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        reportFailure('This torrent source could not be prepared.', {
          code: error instanceof Error ? error.message : 'UnknownError',
        });
      });
    return () => controller.abort();
  }, [engineUrl, reportFailure, torrent, torrentUrl]);

  useEffect(() => {
    if (!nativePlayer || !streamUrl) return;
    closingRef.current = false;
    videoParamsReportedRef.current = false;
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
        setBuffering(payload.active);
      } else if (name === 'ready') {
        setBuffering(false);
        reportMediaReady();
      } else if (name === 'chapters') {
        setChapterCues(nativeChapterCues(payload.items));
      } else if (name === 'subtitleTracks') {
        setSubtitleTracks(parseSubtitleTracks(payload.items));
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
    nativePlayer.load(streamUrl, settings.audioOutput === 'stereo', requestHeaders);

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
    settings.audioOutput,
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
    if (!nativePlayer || subtitleAutoDoneRef.current || !settings.subtitles) return;
    const track = preferredSubtitleTrack(subtitleTracks, preferredSubtitleLanguage);
    if (!track) return;
    subtitleAutoDoneRef.current = true;
    nativePlayer.setSubtitleTrack(track.id);
  }, [nativePlayer, preferredSubtitleLanguage, settings.subtitles, subtitleTracks]);

  useEffect(() => {
    if (
      selection.resumeMode === 'start-over' ||
      resumeAppliedRef.current ||
      duration <= 0 ||
      resumeTime <= 0 ||
      resumeTime >= duration
    )
      return;
    const timeout = window.setTimeout(() => {
      resumeAppliedRef.current = true;
      seekTo(resumeTime);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [duration, resumeTime, seekTo, selection.resumeMode]);

  useEffect(() => {
    if (!duration || chapterMarker) return;

    const controller = new AbortController();
    void lookupCommunityIntro(introIdentity(selection, duration), controller.signal)
      .then((communityMarker) => {
        setCommunityMarker(communityMarker);
        console.info(
          communityMarker
            ? '[kino:intro] trusted community marker'
            : '[kino:intro] no trusted community marker',
          communityMarker ?? '',
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.info(
          '[kino:intro] community lookup failed',
          error instanceof Error ? error.message : error,
        );
      });
    return () => controller.abort();
  }, [chapterMarker, duration, selection]);

  useEffect(() => {
    if (
      !marker ||
      !settings.automaticIntroSkipping ||
      automaticSkipComplete ||
      autoSkipSuppressedRef.current
    )
      return;
    if (time < marker.startMs || time >= marker.endMs) return;
    if (!nativePlayer && !videoRef.current) return;
    seekTo(marker.endMs);
    setAutomaticSkipComplete(true);
    setAutomaticNotice(true);
    reportProgress(true);
  }, [
    automaticSkipComplete,
    marker,
    nativePlayer,
    reportProgress,
    seekTo,
    settings.automaticIntroSkipping,
    time,
  ]);

  useEffect(() => {
    if (!automaticNotice) return;
    const timeout = window.setTimeout(() => setAutomaticNotice(false), 8_000);
    return () => window.clearTimeout(timeout);
  }, [automaticNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.key === 'Escape') {
        if (!subtitleMenuOpen && fullscreen) {
          event.preventDefault();
          exitFullscreen();
        }
        return;
      }
      // Focused controls own Space, arrows, and text entry. In particular the
      // timeline's native arrow step must not become a global ten-second seek.
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, input, textarea, select, summary, a[href], [contenteditable], ' +
            '[role="menu"], [role="menubar"], [role="menuitem"], [role="listbox"], ' +
            '[role="option"], [role="combobox"], [role="textbox"], [role="slider"], [role="button"]',
        )
      )
        return;
      const video = videoRef.current;
      if (!nativePlayer && !video) return;
      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const currentTime = nativePlayer
          ? playbackRef.current.time
          : (video?.currentTime ?? 0) * 1000;
        seekTo(Math.max(0, currentTime + (event.key === 'ArrowRight' ? 10_000 : -10_000)));
        reportProgress(true);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        changeVolume(volume + (event.key === 'ArrowUp' ? 5 : -5));
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMuted();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    changeVolume,
    volume,
    exitFullscreen,
    fullscreen,
    nativePlayer,
    reportProgress,
    seekTo,
    subtitleMenuOpen,
    toggleFullscreen,
    toggleMuted,
    togglePlayback,
  ]);

  const insideIntro = Boolean(marker && time >= marker.startMs && time < marker.endMs);
  const markerStyle = useMemo(() => {
    if (!marker || duration <= 0) return undefined;
    return {
      left: `${(marker.startMs / duration) * 100}%`,
      width: `${((marker.endMs - marker.startMs) / duration) * 100}%`,
    };
  }, [duration, marker]);

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
            reportFailure('This source could not be decoded or loaded.', {
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

      <div className={styles.playerTopbar} ref={topbarRef}>
        <button onClick={() => finishPlayback(onBack)} type="button">
          <ArrowLeft aria-hidden size={18} />
          Back to sources
        </button>
        <div>
          <strong>{result.state?.title ?? selection.meta.name}</strong>
          <span>{selection.video?.title ?? selection.stream.name ?? 'Selected source'}</span>
        </div>
      </div>

      <div aria-live="polite">
        {shutdownError ? (
          <div className={styles.playerStatus} role="alert">
            {shutdownError}
          </div>
        ) : null}
        {result.loading ? <div className={styles.playerStatus}>Preparing source…</div> : null}
        {nativeShell && !nativePlayer ? (
          <div className={styles.playerStatus}>Preparing native player…</div>
        ) : null}
        {torrent && nativePlayer && !streamUrl ? (
          <div className={styles.playerStatus}>{enUS.player.preparingTorrent}</div>
        ) : null}
        {streamUrl && buffering ? <div className={styles.playerStatus}>Buffering…</div> : null}
      </div>

      {settings.skipIntroButton &&
      insideIntro &&
      (!settings.automaticIntroSkipping || automaticSkipComplete) ? (
        <button
          className={styles.skipIntro}
          onClick={() => {
            if (!marker) return;
            seekTo(marker.endMs);
            reportProgress(true);
          }}
          type="button"
        >
          Skip Intro
          <SkipForward aria-hidden size={16} weight="fill" />
        </button>
      ) : null}

      {(ended || nearEnd) && settings.upNext && selection.nextVideo ? (
        <div className={styles.upNext} role="status">
          <span className={styles.upNextLabel}>{enUS.player.upNext}</span>
          <strong>
            {selection.nextVideo.title || `Episode ${selection.nextVideo.episode ?? ''}`.trim()}
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

      {automaticNotice && marker ? (
        <div className={styles.skipNotice} role="status">
          <span>Intro skipped</span>
          <button
            onClick={() => {
              autoSkipSuppressedRef.current = true;
              seekTo(marker.startMs);
              setAutomaticNotice(false);
              reportProgress(true);
            }}
            type="button"
          >
            Undo
          </button>
        </div>
      ) : null}

      {streamUrl ? (
        <div className={styles.playerControls} ref={controlsRef}>
          {subtitleMenuOpen && nativePlayer ? (
            <div
              aria-label={enUS.player.subtitles}
              className={styles.subtitlePanel}
              ref={subtitleMenuRef}
            >
              <div className={styles.subtitleTrackList}>
                <button
                  aria-pressed={selectedSubtitleId === null}
                  onClick={() => selectSubtitleTrack(null)}
                  type="button"
                >
                  {enUS.player.subtitlesOff}
                </button>
                {labelSubtitleTracks(subtitleTracks).map(({ label, track }) => (
                  <button
                    aria-pressed={track.id === selectedSubtitleId}
                    key={track.id}
                    onClick={() => selectSubtitleTrack(track.id)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
                {addonSubtitles.some((subtitle) => !addedSubtitleUrls.has(subtitle.url)) ? (
                  <span className={styles.subtitleGroupLabel}>{enUS.player.subtitlesAddons}</span>
                ) : null}
                {labelAddonSubtitles(
                  addonSubtitles.filter((subtitle) => !addedSubtitleUrls.has(subtitle.url)),
                ).map(({ label, subtitle }) => (
                  <button
                    aria-pressed={false}
                    key={subtitle.id}
                    onClick={() => addAddonSubtitle(subtitle)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.subtitleAdjust}>
                <AdjustRow
                  label={enUS.player.subtitleDelay}
                  onDecrease={() => changeSubtitleDelay(-500)}
                  onIncrease={() => changeSubtitleDelay(500)}
                  value={`${subtitleDelayMs >= 0 ? '+' : ''}${(subtitleDelayMs / 1000).toFixed(1)}s`}
                />
                <AdjustRow
                  label={enUS.player.subtitleSize}
                  onDecrease={() => changeSubtitleSize(-10)}
                  onIncrease={() => changeSubtitleSize(10)}
                  value={`${settings.subtitleSize}%`}
                />
                <AdjustRow
                  label={enUS.player.subtitlePosition}
                  onDecrease={() => changeSubtitlePosition(-5)}
                  onIncrease={() => changeSubtitlePosition(5)}
                  value={`${settings.subtitlePosition}%`}
                />
              </div>
            </div>
          ) : null}
          {fullscreenError ? (
            <div className={styles.fullscreenError} role="alert">
              {fullscreenError}
            </div>
          ) : null}
          <div className={styles.timeline}>
            {markerStyle ? <span className={styles.introRange} style={markerStyle} /> : null}
            <input
              aria-label="Playback position"
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
            <button aria-label={paused ? 'Play' : 'Pause'} onClick={togglePlayback} type="button">
              {paused ? (
                <Play aria-hidden size={20} weight="fill" />
              ) : (
                <Pause aria-hidden size={20} weight="fill" />
              )}
            </button>
            <button aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMuted} type="button">
              {muted || volume === 0 ? (
                <SpeakerSlash aria-hidden size={20} />
              ) : (
                <SpeakerHigh aria-hidden size={20} />
              )}
            </button>
            <input
              aria-label={enUS.player.volume}
              aria-valuetext={`${Math.round(volume)}%`}
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
              <button
                aria-expanded={subtitleMenuOpen}
                aria-label={enUS.player.subtitles}
                className={subtitleMenuOpen ? styles.controlActive : undefined}
                onClick={() => setSubtitleMenuOpen((open) => !open)}
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
