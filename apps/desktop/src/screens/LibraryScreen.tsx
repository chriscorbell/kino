import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { loadLibraryAction } from '../core/actions';
import type { CoreMetaPreview, LibraryState, LibraryRequest } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { enUS } from '../locales/en-US';
import { useState } from 'react';

function typeLabel(type: string | null) {
  if (!type) return enUS.library.all;
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

export function LibraryScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const [request, setRequest] = useState<LibraryRequest | null>(null);
  const result = useCoreModel<LibraryState>(
    'library',
    loadLibraryAction(request),
    `${request?.type ?? 'all'}:${request?.sort ?? 'default'}`,
  );
  const selectable = result.state?.selectable;
  const items = result.state?.catalog ?? [];

  return (
    <div className={styles.page}>
      <h1>{enUS.library.title}</h1>

      {selectable && selectable.types.length > 0 ? (
        <div className={styles.pills} aria-label={enUS.library.filterLabel} role="group">
          {selectable.types.map((option) => (
            <button
              aria-pressed={option.selected}
              className={option.selected ? styles.pillActive : styles.pill}
              key={option.type ?? 'all'}
              onClick={() => setRequest(option.request)}
              type="button"
            >
              {typeLabel(option.type)}
            </button>
          ))}
        </div>
      ) : null}

      {result.loading ? <p className={styles.inlineEmpty}>{enUS.library.loading}</p> : null}
      {result.error ? <p className={styles.loadError}>{enUS.library.error}</p> : null}
      {!result.loading && !result.error && items.length === 0 ? (
        <p className={styles.inlineEmpty}>{enUS.library.empty}</p>
      ) : null}

      {items.length > 0 ? (
        <div className={styles.mediaGrid}>
          {items.map((item) => {
            const preview: CoreMetaPreview = {
              id: item._id,
              inLibrary: true,
              name: item.name,
              ...(item.poster === undefined ? {} : { poster: item.poster }),
              posterShape: item.posterShape ?? 'Poster',
              type: item.type,
              watched: false,
            };
            return (
              <MediaCard
                item={preview}
                key={`${item.type}:${item._id}`}
                onOpen={() => onOpen(preview)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
