import { t as enUS } from '../locales';
import { useEffect, useRef, useState } from 'react';
import { Play } from '@phosphor-icons/react';
import type { CoreMetaPreview } from '../core/types';
import styles from '../App.module.css';
import { useTextOverflow } from './useTextOverflow';

function year(item: CoreMetaPreview) {
  return item.releaseInfo?.split(/[–-]/)[0] || item.released?.slice(0, 4) || item.type;
}

export function MediaCard({
  item,
  onOpen,
  resumeProgress,
}: {
  item: CoreMetaPreview;
  onOpen: () => void;
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
      aria-label={resumeProgress === undefined ? undefined : enUS.home.resumeTitle(item.name)}
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
        {item.watched ? <span className={styles.watchedBadge}>{enUS.media.watched}</span> : null}
      </span>
      <span className={styles.mediaTitle} ref={titleRef}>
        {item.name}
      </span>
      {resumeProgress === undefined ? <span className={styles.mediaMeta}>{year(item)}</span> : null}
    </button>
  );
}
