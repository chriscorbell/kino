import { Headphones } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import styles from '../App.module.css';
import { t } from '../locales';
import { audioTrackLabel, type AudioTrack } from '../player/audio';

export function AudioTrackPicker({
  open,
  onOpenChange,
  onSelect,
  tracks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: number) => void;
  tracks: AudioTrack[];
}) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    (
      panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      panel.current?.querySelector<HTMLButtonElement>('button')
    )?.focus({ preventScroll: true });
    const pointer = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
      button.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    };
  }, [open, onOpenChange]);
  const labels = tracks.map(audioTrackLabel);
  return (
    <>
      <button
        aria-expanded={open}
        aria-controls="audio-track-picker"
        aria-haspopup="dialog"
        aria-label={t.player.audioTracks}
        className={open ? styles.controlActive : undefined}
        disabled={!tracks.length}
        ref={button}
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        <Headphones aria-hidden size={20} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t.player.audioTracks}
          className={`${styles.subtitlePanel} ${styles.audioPanel}`}
          id="audio-track-picker"
          ref={panel}
        >
          <div className={styles.subtitleTrackList}>
            {tracks.map((track, index) => (
              <button
                aria-pressed={track.selected}
                key={track.id}
                type="button"
                onClick={() => {
                  onSelect(track.id);
                  onOpenChange(false);
                  button.current?.focus({ preventScroll: true });
                }}
              >
                {labels.filter((label) => label === labels[index]).length > 1
                  ? `${labels[index]} · ${t.player.audioTrack(track.id)}`
                  : labels[index]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
