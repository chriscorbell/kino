import { ArrowLeft, ArrowsOut, Pause, Play, SkipForward, SpeakerHigh } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { loadPlayerAction, playerAction, type PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import type { PlayerState } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { lookupCommunityIntro, type IntroMarker } from '../intro/markers';
import { connectNativePlayer, nativeShellPresent, type NativePlayer } from '../native/player';
import type { KinoSettings } from '../settings';

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
  const imdbId = /^tt\d+$/.test(selection.meta.id) ? selection.meta.id : undefined;
  return {
    durationMs,
    ...(selection.video?.episode === undefined ? {} : { episode: selection.video.episode }),
    ...(imdbId === undefined ? {} : { imdbId }),
    ...(selection.video?.season === undefined ? {} : { season: selection.video.season }),
  };
}

function nativeErrorMessage(code: unknown) {
  if (code === 'render-context-unavailable') {
    return 'Kino could not start the native video renderer.';
  }
  return 'The native player could not decode or load this source.';
}

export function PlayerScreen({
  onBack,
  selection,
  settings,
}: {
  onBack: () => void;
  selection: PlaybackSelection;
  settings: KinoSettings;
}) {
  const { transport } = useCore();
  const result = useCoreModel<PlayerState>(
    'player',
    loadPlayerAction(selection),
    `${selection.meta.id}:${selection.video?.id ?? 'movie'}:${selection.streamTransportUrl}`,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef({ duration: 0, time: 0 });
  const lastProgressRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const autoSkippedRef = useRef(false);
  const autoSkipSuppressedRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [nativePlayer, setNativePlayer] = useState<NativePlayer | null>(null);
  const [marker, setMarker] = useState<IntroMarker | null>(null);
  const [automaticNotice, setAutomaticNotice] = useState(false);
  const stream = result.state?.stream?.type === 'Ready' ? result.state.stream.content : null;
  const streamUrl = stream?.url ?? null;
  const resumeTime = result.state?.libraryItem?.state.timeOffset ?? 0;
  const sourceFailed = result.state?.stream?.type === 'Err' || Boolean(result.error || mediaError);
  const nativeShell = nativeShellPresent();

  const updateDuration = useCallback((milliseconds: number) => {
    playbackRef.current.duration = milliseconds;
    setDuration(milliseconds);
  }, []);

  const updateTime = useCallback((milliseconds: number) => {
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

  const togglePlayback = useCallback(() => {
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
      setMediaError('Playback could not start with this source.');
      console.error(
        '[kino:player] playback start failed',
        error instanceof DOMException ? error.name : 'UnknownError',
      );
    });
  }, [dispatchPlayer, nativePlayer, paused]);

  const seekTo = useCallback(
    (milliseconds: number) => {
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

  const toggleMuted = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (nativePlayer) {
      nativePlayer.setMuted(nextMuted);
    } else if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }, [muted, nativePlayer]);

  const enterFullscreen = useCallback(() => {
    if (nativePlayer) {
      nativePlayer.setFullscreen(true);
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }, [nativePlayer]);

  useEffect(() => {
    if (!nativeShell) return;
    let disposed = false;
    void connectNativePlayer()
      .then((player) => {
        if (!disposed) setNativePlayer(player);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setMediaError('Kino could not connect to the native player.');
        console.error(
          '[kino:native] player connection failed',
          error instanceof Error ? error.message : 'UnknownError',
        );
      });
    return () => {
      disposed = true;
    };
  }, [nativeShell]);

  useEffect(() => {
    if (!nativePlayer || !streamUrl) return;
    const onEvent = (name: string, payload: Record<string, unknown>) => {
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
        dispatchPlayer('PausedChanged', { paused: payload.paused });
      } else if (name === 'muted' && typeof payload.muted === 'boolean') {
        setMuted(payload.muted);
      } else if (name === 'buffering' && typeof payload.active === 'boolean') {
        setBuffering(payload.active);
      } else if (name === 'ready') {
        setBuffering(false);
      } else if (name === 'error') {
        setBuffering(false);
        setPaused(true);
        setMediaError(nativeErrorMessage(payload.code));
      } else if (name === 'ended') {
        setBuffering(false);
        setPaused(true);
        reportProgress();
        dispatchPlayer('Ended');
      }
    };

    nativePlayer.playerEvent.connect(onEvent);
    nativePlayer.load(streamUrl, settings.audioOutput === 'stereo');

    return () => {
      nativePlayer.playerEvent.disconnect(onEvent);
      nativePlayer.stop();
    };
  }, [
    dispatchPlayer,
    nativePlayer,
    reportProgress,
    settings.audioOutput,
    streamUrl,
    updateDuration,
    updateTime,
  ]);

  useEffect(() => {
    if (resumeAppliedRef.current || duration <= 0 || resumeTime <= 0 || resumeTime >= duration)
      return;
    const timeout = window.setTimeout(() => {
      resumeAppliedRef.current = true;
      seekTo(resumeTime);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [duration, resumeTime, seekTo]);

  useEffect(() => {
    if (!duration) return;
    const controller = new AbortController();
    void lookupCommunityIntro(introIdentity(selection, duration), controller.signal)
      .then(setMarker)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.info(
          '[kino:intro] no trusted community marker',
          error instanceof Error ? error.message : error,
        );
      });
    return () => controller.abort();
  }, [duration, selection]);

  useEffect(() => {
    if (
      !marker ||
      !settings.automaticIntroSkipping ||
      autoSkippedRef.current ||
      autoSkipSuppressedRef.current
    )
      return;
    if (time < marker.startMs || time >= marker.endMs) return;
    if (!nativePlayer && !videoRef.current) return;
    seekTo(marker.endMs);
    autoSkippedRef.current = true;
    setAutomaticNotice(true);
    reportProgress(true);
  }, [marker, nativePlayer, reportProgress, seekTo, settings.automaticIntroSkipping, time]);

  useEffect(() => {
    if (!automaticNotice) return;
    const timeout = window.setTimeout(() => setAutomaticNotice(false), 8_000);
    return () => window.clearTimeout(timeout);
  }, [automaticNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      } else if (event.key.toLowerCase() === 'm') {
        toggleMuted();
      } else if (event.key.toLowerCase() === 'f') {
        enterFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterFullscreen, nativePlayer, reportProgress, seekTo, toggleMuted, togglePlayback]);

  useEffect(() => () => reportProgress(), [reportProgress]);

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
      className={`${styles.player} ${nativeShell ? styles.nativePlayer : ''}`}
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
            dispatchPlayer('Ended');
          }}
          onError={(event) => {
            const video = event.currentTarget;
            setBuffering(false);
            setMediaError('This source could not be decoded or loaded.');
            console.error('[kino:player] media failure', {
              code: video.error?.code ?? 0,
              networkState: video.networkState,
              readyState: video.readyState,
            });
          }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            updateDuration(video.duration * 1000);
            setPaused(video.paused);
          }}
          onLoadStart={() => setBuffering(true)}
          onPause={() => {
            setPaused(true);
            dispatchPlayer('PausedChanged', { paused: true });
            reportProgress();
          }}
          onPlay={() => {
            setPaused(false);
            dispatchPlayer('PausedChanged', { paused: false });
          }}
          onPlaying={() => setBuffering(false)}
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
          onWaiting={() => setBuffering(true)}
        />
      ) : null}

      <div className={styles.playerTopbar}>
        <button onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={18} />
          Back to sources
        </button>
        <div>
          <strong>{result.state?.title ?? selection.meta.name}</strong>
          <span>{selection.video?.title ?? selection.stream.name ?? 'Selected source'}</span>
        </div>
      </div>

      {result.loading ? <div className={styles.playerStatus}>Preparing source…</div> : null}
      {nativeShell && !nativePlayer && !sourceFailed ? (
        <div className={styles.playerStatus}>Preparing native player…</div>
      ) : null}
      {sourceFailed ? (
        <div className={styles.playerStatus}>
          <strong>Source failed</strong>
          <span>{mediaError ?? 'Return to source selection and choose another option.'}</span>
        </div>
      ) : null}
      {streamUrl && buffering && !sourceFailed ? (
        <div className={styles.playerStatus}>Buffering…</div>
      ) : null}

      {settings.skipIntroButton && insideIntro && !settings.automaticIntroSkipping ? (
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
        <div className={styles.playerControls}>
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
              <SpeakerHigh aria-hidden size={20} />
            </button>
            <span className={styles.timeLabel}>
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <button aria-label="Fullscreen" onClick={enterFullscreen} type="button">
              <ArrowsOut aria-hidden size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
