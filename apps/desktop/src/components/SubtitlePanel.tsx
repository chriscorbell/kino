import { Minus, Plus } from '@phosphor-icons/react';
import type { RefObject } from 'react';

import styles from '../App.module.css';
import { t as enUS } from '../locales';
import {
  labelAddonSubtitles,
  labelSubtitleTracks,
  type AddonSubtitle,
  type SubtitleTrack,
} from '../player/subtitles';

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
        <button aria-label={enUS.player.decrease(label)} onClick={onDecrease} type="button">
          <Minus aria-hidden size={14} />
        </button>
        <span className={styles.subtitleAdjustValue}>{value}</span>
        <button aria-label={enUS.player.increase(label)} onClick={onIncrease} type="button">
          <Plus aria-hidden size={14} />
        </button>
      </span>
    </div>
  );
}

/** Embedded and add-on subtitle choices, with delay, size, and position. */
export function SubtitlePanel({
  addonSubtitles,
  delayMs,
  onAddAddon,
  onDelay,
  onPosition,
  onSelect,
  onSize,
  panelRef,
  position,
  selectedId,
  size,
  tracks,
}: {
  /** Add-on subtitles not yet added to the player. */
  addonSubtitles: AddonSubtitle[];
  delayMs: number;
  onAddAddon: (subtitle: AddonSubtitle) => void;
  onDelay: (deltaMs: number) => void;
  onPosition: (delta: number) => void;
  onSelect: (id: number | null) => void;
  onSize: (delta: number) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  position: number;
  selectedId: number | null;
  size: number;
  tracks: SubtitleTrack[];
}) {
  return (
    <div aria-label={enUS.player.subtitles} className={styles.subtitlePanel} ref={panelRef}>
      <div className={styles.subtitleTrackList}>
        <button aria-pressed={selectedId === null} onClick={() => onSelect(null)} type="button">
          {enUS.player.subtitlesOff}
        </button>
        {labelSubtitleTracks(tracks).map(({ label, track }) => (
          <button
            aria-pressed={track.id === selectedId}
            key={track.id}
            onClick={() => onSelect(track.id)}
            type="button"
          >
            {label}
          </button>
        ))}
        {addonSubtitles.length > 0 ? (
          <span className={styles.subtitleGroupLabel}>{enUS.player.subtitlesAddons}</span>
        ) : null}
        {labelAddonSubtitles(addonSubtitles).map(({ label, subtitle }) => (
          <button
            aria-pressed={false}
            key={subtitle.id}
            onClick={() => onAddAddon(subtitle)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.subtitleAdjust}>
        <AdjustRow
          label={enUS.player.subtitleDelay}
          onDecrease={() => onDelay(-500)}
          onIncrease={() => onDelay(500)}
          value={enUS.player.subtitleDelayValue(delayMs)}
        />
        <AdjustRow
          label={enUS.player.subtitleSize}
          onDecrease={() => onSize(-10)}
          onIncrease={() => onSize(10)}
          value={enUS.format.percent(size)}
        />
        <AdjustRow
          label={enUS.player.subtitlePosition}
          onDecrease={() => onPosition(-5)}
          onIncrease={() => onPosition(5)}
          value={enUS.format.percent(position)}
        />
      </div>
    </div>
  );
}
