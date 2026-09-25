import { t as enUS } from '../locales';
import { useEffect, useRef, useState } from 'react';
import { Play } from '@phosphor-icons/react';
import type { CoreMetaPreview } from '../core/types';
import styles from '../styles/browse.module.css';
import { useTextOverflow } from './useTextOverflow';

function year(item: CoreMetaPreview) {
  return item.releaseInfo?.split(/[–-]/)[0] || item.released?.slice(0, 4) || item.type;
}

export function MediaCard({
  item,
  onOpen,
  badge = null,
  progress,
  resumeEpisode = null,
  resumeProgress,
}: {
  item: CoreMetaPreview;
  /** A short note on the poster, such as new episodes, shown in place of Watched. */
  badge?: string | null;
  onOpen: () => void;
  /** Partial progress without the resume affordance, for a card that opens details. */
  progress?: number;
  resumeEpisode?: { season: number; episode: number } | null;
  resumeProgress?: number;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const truncated = useTextOverflow(titleRef, item.name);
  const [titleDismissed, setTitleDismissed] = useState(false);
  useEffect(() => {
    if (!truncated) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTitleDismissed(true);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [truncated]);
  return (
    <button
      aria-label={
        resumeProgress === undefined
          ? undefined
          : enUS.home.resumeTitle(
              item.name,
              resumeEpisode
                ? enUS.home.episodeLong(resumeEpisode.season, resumeEpisode.episode)
                : undefined,
            )
      }
      className={styles.mediaCard}
      onClick={onOpen}
      onFocus={() => setTitleDismissed(false)}
      onMouseEnter={() => setTitleDismissed(false)}
      type="button"
    >
      <span className={styles.posterFrame}>
        {item.poster ? (
          <img alt="" className={styles.poster} loading="lazy" src={item.poster} />
        ) : (
          <span className={styles.posterFallback}>{item.name.slice(0, 1)}</span>
        )}
        {resumeProgress === undefined &&
        progress !== undefined &&
        progress > 0 &&
        progress < 100 ? (
          <span aria-hidden className={styles.progressTrack}>
            <span style={{ width: `${progress}%` }} />
          </span>
        ) : null}
        {resumeProgress !== undefined ? (
          <>
            <span aria-hidden className={styles.playOverlay}>
              <Play size={24} weight="fill" />
            </span>
            <span aria-hidden className={styles.progressTrack}>
              <span style={{ width: `${Math.max(0, Math.min(100, resumeProgress))}%` }} />
            </span>
          </>
        ) : null}
        {truncated && !titleDismissed ? (
          <span aria-hidden className={styles.fullMediaTitle}>
            {item.name}
          </span>
        ) : null}
        {badge ? (
          <span className={styles.watchedBadge}>{badge}</span>
        ) : item.watched ? (
          <span className={styles.watchedBadge}>{enUS.media.watched}</span>
        ) : null}
      </span>
      <span className={styles.mediaTitle} ref={titleRef}>
        {item.name}
      </span>
      {resumeProgress === undefined ? (
        <span className={styles.mediaMeta}>{year(item)}</span>
      ) : resumeEpisode ? (
        <span className={styles.mediaMeta}>
          {enUS.home.episodeShort(resumeEpisode.season, resumeEpisode.episode)}
        </span>
      ) : null}
    </button>
  );
}
