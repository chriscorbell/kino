import { ArrowLeft, ArrowsOut, Pause, Play, SkipForward, SpeakerHigh } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { loadPlayerAction, playerAction, type PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import type { PlayerState } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { lookupCommunityIntro, type IntroMarker } from '../intro/markers';
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
  const lastProgressRef = useRef(0);
  const autoSkippedRef = useRef(false);
  const autoSkipSuppressedRef = useRef(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [marker, setMarker] = useState<IntroMarker | null>(null);
  const [automaticNotice, setAutomaticNotice] = useState(false);
  const stream = result.state?.stream?.type === 'Ready' ? result.state.stream.content : null;
  const streamUrl = stream?.url ?? null;
  const resumeTime = result.state?.libraryItem?.state.timeOffset ?? 0;
  const sourceFailed = result.state?.stream?.type === 'Err' || Boolean(result.error || mediaError);

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
      if (!video || !Number.isFinite(video.duration)) return;
      const args = {
        device: 'kino-web',
        duration: Math.round(video.duration * 1000),
        time: Math.round(video.currentTime * 1000),
      };
      dispatchPlayer(isSeek ? 'Seek' : 'TimeChanged', args);
    },
    [dispatchPlayer],
  );

  const togglePlayback = useCallback(() => {
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
  }, []);

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
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = marker.endMs / 1000;
    setTime(marker.endMs);
    autoSkippedRef.current = true;
    setAutomaticNotice(true);
    reportProgress(true);
  }, [marker, reportProgress, settings.automaticIntroSkipping, time]);

  useEffect(() => {
    if (!automaticNotice) return;
    const timeout = window.setTimeout(() => setAutomaticNotice(false), 8_000);
    return () => window.clearTimeout(timeout);
  }, [automaticNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        video.currentTime = Math.max(
          0,
          video.currentTime + (event.key === 'ArrowRight' ? 10 : -10),
        );
        reportProgress(true);
      } else if (event.key.toLowerCase() === 'm') {
        video.muted = !video.muted;
      } else if (event.key.toLowerCase() === 'f') {
        void containerRef.current?.requestFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reportProgress, togglePlayback]);

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
    <div className={styles.player} ref={containerRef}>
      {streamUrl ? (
        <video
          autoPlay
          onCanPlay={() => setBuffering(false)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration * 1000)}
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
            setDuration(video.duration * 1000);
            setPaused(video.paused);
            if (resumeTime > 0 && resumeTime < video.duration * 1000)
              video.currentTime = resumeTime / 1000;
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
            setTime(nextTime);
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
            const video = videoRef.current;
            if (!video || !marker) return;
            video.currentTime = marker.endMs / 1000;
            setTime(marker.endMs);
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
              const video = videoRef.current;
              if (!video) return;
              autoSkipSuppressedRef.current = true;
              video.currentTime = marker.startMs / 1000;
              setTime(marker.startMs);
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
                const video = videoRef.current;
                if (!video) return;
                video.currentTime = Number(event.target.value) / 1000;
                setTime(Number(event.target.value));
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
            <button
              aria-label="Mute"
              onClick={() => {
                if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
              }}
              type="button"
            >
              <SpeakerHigh aria-hidden size={20} />
            </button>
            <span className={styles.timeLabel}>
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <button
              aria-label="Fullscreen"
              onClick={() => void containerRef.current?.requestFullscreen()}
              type="button"
            >
              <ArrowsOut aria-hidden size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
