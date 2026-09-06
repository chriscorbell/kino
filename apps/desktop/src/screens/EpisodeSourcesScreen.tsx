import { ArrowLeft } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import styles from '../App.module.css';
import type { CoreMetaPreview, CoreVideo } from '../core/types';
import { t } from '../locales';

export function EpisodeSourcesScreen({
  meta,
  video,
  onBack,
  children,
}: {
  meta: CoreMetaPreview;
  video: CoreVideo | null;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.episodeSourcesPage}>
      <button className={styles.backButton} onClick={onBack} type="button">
        <ArrowLeft aria-hidden size={16} />
        {t.actions.back}
      </button>
      <header className={styles.episodeSourcesHeader}>
        <p>{meta.name}</p>
        <h1>{video?.title || t.details.episode(video?.episode ?? null)}</h1>
        {video ? (
          <p className={styles.detailMetadata}>
            {t.details.episodeIdentity(video.season, video.episode)}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
