import type { CoreMetaPreview } from '../core/types';
import styles from '../App.module.css';

function year(item: CoreMetaPreview) {
  return item.releaseInfo?.split(/[–-]/)[0] || item.released?.slice(0, 4) || item.type;
}

export function MediaCard({ item, onOpen }: { item: CoreMetaPreview; onOpen: () => void }) {
  return (
    <button className={styles.mediaCard} onClick={onOpen} type="button">
      <span className={styles.posterFrame}>
        {item.poster ? (
          <img alt="" className={styles.poster} loading="lazy" src={item.poster} />
        ) : (
          <span className={styles.posterFallback}>{item.name.slice(0, 1)}</span>
        )}
        {item.watched ? <span className={styles.watchedBadge}>Watched</span> : null}
      </span>
      <span className={styles.mediaTitle}>{item.name}</span>
      <span className={styles.mediaMeta}>{year(item)}</span>
    </button>
  );
}
