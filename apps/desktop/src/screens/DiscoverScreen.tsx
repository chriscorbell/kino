import { CaretDown } from '@phosphor-icons/react';
import { useState } from 'react';

import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { LoadMore } from '../components/LoadMore';
import { useCore } from '../core/context';
import type { CoreTransport } from '../core/transport';
import { loadCatalogAction } from '../core/actions';
import { catalogRequestFromDeepLink, catalogRequestKey } from '../core/catalog';
import type { CatalogRequest, CatalogWithFiltersState, CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

function typeLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function DiscoverScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const { transport } = useCore();
  const [request, setRequest] = useState<CatalogRequest | null>(null);
  const result = useCoreModel<CatalogWithFiltersState>(
    'discover',
    loadCatalogAction(request),
    catalogRequestKey(request),
  );
  const key = catalogRequestKey(request);
  const [operation, setOperation] = useState<{ key: string; transport: CoreTransport } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ key: string; transport: CoreTransport } | null>(null);
  const loadingPage = Boolean(
    result.state?.paging?.loading || (operation?.key === key && operation.transport === transport),
  );
  const pagingError =
    !result.loading &&
    Boolean(
      result.state?.paging?.error || (failure?.key === key && failure.transport === transport),
    );
  const loadMore = () => {
    if (!transport || loadingPage || result.loading) return;
    const current = { key, transport };
    setOperation(current);
    setFailure(null);
    void transport
      .dispatch({ action: 'CatalogWithFilters', args: { action: 'LoadNextPage' } }, 'discover')
      .catch(() => setFailure(current))
      .finally(() => setOperation((previous) => (previous === current ? null : previous)));
  };
  const selectable = result.state?.selectable;
  const content = result.state?.catalog?.content ?? null;
  const items = content?.type === 'Ready' ? content.content : [];
  // Add-ons expose genre-style filters under varying names; the first
  // non-required filter with options is the one worth surfacing.
  const genreFilter = selectable?.extra.find(
    (extra) => !extra.isRequired && extra.options.length > 0,
  );

  const select = (link: string | undefined) => {
    const next = catalogRequestFromDeepLink(link);
    if (next) setRequest(next);
  };

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
            <div className={styles.genreMenu}>
              <select
                aria-label={enUS.discover.genreLabel}
                className={styles.genreSelect}
                onChange={(event) => {
                  const option = genreFilter.options[Number(event.target.value)];
                  select(option?.deepLinks?.discover);
                }}
                value={Math.max(
                  0,
                  genreFilter.options.findIndex((option) => option.selected),
                )}
              >
                {genreFilter.options.map((option, index) => (
                  <option key={option.value ?? 'all'} value={index}>
                    {option.value ?? enUS.discover.allGenres}
                  </option>
                ))}
              </select>
              <CaretDown aria-hidden size={13} />
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
      {selectable?.nextPage || loadingPage || pagingError ? (
        <LoadMore error={pagingError} loading={result.loading || loadingPage} onLoad={loadMore} />
      ) : null}
    </div>
  );
}
