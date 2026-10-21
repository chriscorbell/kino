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
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../styles/player.module.css';
import { AudioTrackPicker } from '../components/AudioTrackPicker';
import { SubtitlePanel } from '../components/SubtitlePanel';
import { t as enUS } from '../locales';
import { usePlayback, type PlaybackSession } from '../playback';
import { formatTime } from '../player/formatTime';
import { useFullscreen } from '../player/useFullscreen';
import { useIdleControls } from '../player/useIdleControls';
import { useIntroSkip } from '../player/useIntroSkip';
import { usePlayerKeyboard } from '../player/usePlayerKeyboard';
import { inUpNextWindow } from '../player/upNext';
import { useKinoSettings } from '../useKinoSettings';

export function PlayerScreen({ session }: { session: PlaybackSession }) {
  const [settings] = useKinoSettings();
  const { controls, selection } = session;
  const playback = usePlayback(session);
  const { buffering, ended, exit, loaded, muted, nextVideo, paused, waitingFor } = playback;
  const { buffered: bufferedTime, duration, time } = playback.position;
  const hasPlayer = loaded && !waitingFor.player;
  const tracks = playback.kind === 'native' && !waitingFor.player;
  const containerRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => (video ? session.attach(video) : undefined),
    [session],
  );
  const {
    error: fullscreenError,
    exit: exitFullscreen,
    fullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen(containerRef, playback.nativeFullscreen);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const subtitleMenuRef = useRef<HTMLDivElement>(null);
  const subtitleButtonRef = useRef<HTMLButtonElement>(null);
  const changeAudioMenu = useCallback((open: boolean) => {
    setAudioMenuOpen(open);
    if (open) setSubtitleMenuOpen(false);
  }, []);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const selectedSubtitleId = playback.subtitles.tracks.find((track) => track.selected)?.id ?? null;
  const nearEnd = inUpNextWindow(time, duration);

  const controlsVisible = useIdleControls(
    topbarRef,
    controlsRef,
    paused ||
      buffering ||
      subtitleMenuOpen ||
      audioMenuOpen ||
      waitingFor.core ||
      !loaded ||
      Boolean(exit === 'save-failed' || fullscreenError),
  );

  const intro = useIntroSkip({
    automatic: settings.automaticIntroSkipping,
    chapterCues: playback.chapters,
    duration,
    hasPlayer,
    seek: controls.seek,
    selection,
    time,
  });
  const { marker } = intro;

  const currentTime = useCallback(() => session.getSnapshot().position.time, [session]);
  usePlayerKeyboard({
    hasPlayer,
    changeVolume: controls.setVolume,
    currentTime,
    exitFullscreen,
    fullscreen,
    menuOpen: subtitleMenuOpen || audioMenuOpen,
    seek: controls.seek,
    toggleFullscreen,
    toggleMuted: controls.toggleMute,
    togglePlayback: controls.togglePause,
    volume: settings.volume,
  });

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

  return (
    <div
      className={`${styles.player} ${playback.kind === 'native' ? styles.nativePlayer : ''} ${controlsVisible ? '' : styles.controlsHidden}`}
      ref={containerRef}
    >
      {loaded && playback.kind === 'browser' ? (
        <video autoPlay playsInline ref={attachVideo} />
      ) : null}

      {loaded ? (
        // A click on the picture plays or pauses, and a double click toggles
        // fullscreen. Its two clicks cancel out, as in other players.
        <div
          aria-hidden
          className={styles.playerSurface}
          onClick={controls.togglePause}
          onDoubleClick={toggleFullscreen}
        />
      ) : null}

      <div className={styles.playerTopbar} ref={topbarRef}>
        <button onClick={() => controls.leave({ kind: 'back' })} type="button">
          <ArrowLeft aria-hidden size={18} />
          {enUS.player.backToSources}
        </button>
        <div>
          <strong>{playback.title}</strong>
          <span>
            {selection.video?.title ?? selection.stream.name ?? enUS.player.selectedSource}
          </span>
        </div>
      </div>

      <div aria-live="polite">
        {exit === 'save-failed' ? (
          <div className={styles.playerStatus} role="alert">
            {enUS.player.saveFailed}
          </div>
        ) : exit === 'saving' ? (
          <div className={styles.playerStatus}>{enUS.player.savingProgress}</div>
        ) : null}
        {waitingFor.core ? (
          <div className={styles.playerStatus}>{enUS.player.preparingSource}</div>
        ) : null}
        {waitingFor.player ? (
          <div className={styles.playerStatus}>{enUS.player.preparingNative}</div>
        ) : null}
        {waitingFor.peers ? (
          <div className={styles.playerStatus}>{enUS.player.preparingTorrent}</div>
        ) : null}
        {loaded && buffering ? (
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

      {(ended || nearEnd) && settings.upNext && nextVideo ? (
        <div className={styles.upNext} role="status">
          <span className={styles.upNextLabel}>{enUS.player.upNext}</span>
          <strong>{nextVideo.title || enUS.details.episode(nextVideo.episode)}</strong>
          <button
            onClick={() => controls.leave({ kind: 'upNext', video: nextVideo })}
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

      {loaded ? (
        <div className={styles.playerControls} ref={controlsRef}>
          {subtitleMenuOpen && tracks ? (
            <SubtitlePanel
              addonSubtitles={playback.subtitles.addon}
              delayMs={playback.subtitles.delayMs}
              onAddAddon={(subtitle) => {
                controls.addAddonSubtitle(subtitle);
                setSubtitleMenuOpen(false);
              }}
              onDelay={controls.adjustSubtitleDelay}
              onPosition={controls.adjustSubtitlePosition}
              onSelect={controls.selectSubtitle}
              onSize={controls.adjustSubtitleSize}
              panelRef={subtitleMenuRef}
              position={settings.subtitlePosition}
              selectedId={selectedSubtitleId}
              size={settings.subtitleSize}
              tracks={playback.subtitles.tracks}
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
              onChange={(event) => controls.seek(Number(event.target.value))}
              step={1000}
              type="range"
              value={Math.min(time, duration || 1)}
            />
          </div>
          <div className={styles.controlRow}>
            <button
              aria-label={paused ? enUS.player.play : enUS.player.pause}
              onClick={controls.togglePause}
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
              onClick={controls.toggleMute}
              type="button"
            >
              {muted || settings.volume === 0 ? (
                <SpeakerSlash aria-hidden size={20} />
              ) : (
                <SpeakerHigh aria-hidden size={20} />
              )}
            </button>
            <input
              aria-label={enUS.player.volume}
              aria-valuetext={enUS.format.percent(Math.round(settings.volume))}
              className={styles.volumeSlider}
              min={0}
              max={100}
              step={1}
              type="range"
              value={settings.volume}
              onChange={(event) => controls.setVolume(Number(event.target.value))}
            />
            <span className={styles.timeLabel}>
              {formatTime(time)} / {formatTime(duration)}
            </span>
            {tracks ? (
              <AudioTrackPicker
                open={audioMenuOpen}
                onOpenChange={changeAudioMenu}
                onSelect={controls.selectAudio}
                tracks={playback.audioTracks}
              />
            ) : null}
            {tracks ? (
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
