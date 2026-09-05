import { useEffect, useRef, useState } from 'react';
import type { CoreMetaPreview } from '../core/types';
import styles from '../App.module.css';
import { useTextOverflow } from './useTextOverflow';

function year(item: CoreMetaPreview) {
  return item.releaseInfo?.split(/[–-]/)[0] || item.released?.slice(0, 4) || item.type;
}

export function MediaCard({ item, onOpen }: { item: CoreMetaPreview; onOpen: () => void }) {
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
        {truncated && !titleDismissed ? (
          <span aria-hidden className={styles.fullMediaTitle}>
            {item.name}
          </span>
        ) : null}
        {item.watched ? <span className={styles.watchedBadge}>Watched</span> : null}
      </span>
      <span className={styles.mediaTitle} ref={titleRef}>
        {item.name}
      </span>
      <span className={styles.mediaMeta}>{year(item)}</span>
    </button>
  );
}
