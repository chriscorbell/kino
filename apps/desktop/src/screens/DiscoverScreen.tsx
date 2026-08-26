import { CaretDown } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { loadCatalogAction } from '../core/actions';
import { catalogRequestFromDeepLink, catalogRequestKey } from '../core/catalog';
import type { CatalogRequest, CatalogWithFiltersState, CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

function typeLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function DiscoverScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const [request, setRequest] = useState<CatalogRequest | null>(null);
  const [genresOpen, setGenresOpen] = useState(false);
  const genreRef = useRef<HTMLDivElement>(null);
  const result = useCoreModel<CatalogWithFiltersState>(
    'discover',
    loadCatalogAction(request),
    catalogRequestKey(request),
  );
  const selectable = result.state?.selectable;
  const content = result.state?.catalog?.content ?? null;
  const items = content?.type === 'Ready' ? content.content : [];
  // Add-ons expose genre-style filters under varying names; the first
  // non-required filter with options is the one worth surfacing.
  const genreFilter = selectable?.extra.find(
    (extra) => !extra.isRequired && extra.options.length > 0,
  );
  const selectedGenre = genreFilter?.options.find((option) => option.selected)?.value ?? null;

  const select = (link: string | undefined) => {
    const next = catalogRequestFromDeepLink(link);
    if (next) setRequest(next);
  };

  useEffect(() => {
    if (!genresOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!genreRef.current?.contains(event.target as Node)) setGenresOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setGenresOpen(false);
      genreRef.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [genresOpen]);

  return (
    <div className={styles.page}>
      <h1>{enUS.discover.title}</h1>

      {selectable && selectable.types.length > 0 ? (
        <div className={styles.pills} aria-label={enUS.discover.typeLabel} role="group">
          {selectable.types.map((option) => (
            <button
              aria-pressed={option.selected}
              className={option.selected ? styles.pillActive : styles.pill}
              key={option.type}
              onClick={() => select(option.deepLinks?.discover)}
              type="button"
            >
              {typeLabel(option.type)}
            </button>
          ))}
        </div>
      ) : null}

      {selectable && selectable.catalogs.length > 0 ? (
        <div className={styles.discoverFilters}>
          <div className={styles.catalogTabs} aria-label={enUS.discover.catalogLabel} role="group">
            {selectable.catalogs.map((option) => (
              <button
                aria-pressed={option.selected}
                className={option.selected ? styles.catalogTabActive : styles.catalogTab}
                key={`${option.addon.manifest.id}:${option.id}:${option.name}`}
                onClick={() => select(option.deepLinks?.discover)}
                type="button"
              >
                {option.name}
              </button>
            ))}
          </div>

          {genreFilter ? (
            <div className={styles.genreMenu} ref={genreRef}>
              <button
                aria-expanded={genresOpen}
                className={styles.genreButton}
                onClick={() => setGenresOpen((open) => !open)}
                type="button"
              >
                {selectedGenre ?? enUS.discover.allGenres}
                <CaretDown aria-hidden size={13} />
              </button>
              {genresOpen ? (
                <div className={styles.genreList} role="listbox">
                  {genreFilter.options.map((option) => (
                    <button
                      aria-pressed={option.selected}
                      key={option.value ?? 'all'}
                      onClick={() => {
                        select(option.deepLinks?.discover);
                        setGenresOpen(false);
                      }}
                      type="button"
                    >
                      {option.value ?? enUS.discover.allGenres}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div aria-live="polite">
        {result.loading ? <p className={styles.inlineEmpty}>{enUS.discover.loading}</p> : null}
        {result.error || content?.type === 'Err' ? (
          <p className={styles.loadError}>{enUS.discover.error}</p>
        ) : null}
        {!result.loading && items.length === 0 && content?.type !== 'Err' ? (
          <p className={styles.inlineEmpty}>{enUS.discover.empty}</p>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className={styles.mediaGrid}>
          {items.map((item) => (
            <MediaCard item={item} key={`${item.type}:${item.id}`} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
