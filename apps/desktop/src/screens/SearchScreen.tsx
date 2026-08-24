import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { loadSearchAction } from '../core/actions';
import { useCore } from '../core/context';
import type { BoardState, CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { enUS } from '../locales/en-US';

export function SearchScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const { transport } = useCore();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const result = useCoreModel<BoardState>(
    'search',
    deferredQuery ? loadSearchAction(deferredQuery) : null,
    deferredQuery,
  );
  const catalogCount = result.state?.catalogs.length ?? 0;

  useEffect(() => {
    if (!transport || !deferredQuery || catalogCount === 0) return;
    void transport.dispatch(
      {
        action: 'CatalogsWithExtra',
        args: { action: 'LoadRange', args: { start: 0, end: catalogCount } },
      },
      'search',
    );
  }, [catalogCount, deferredQuery, transport]);
  const items = useMemo(() => {
    if (!deferredQuery) return [];
    const unique = new Map<string, CoreMetaPreview>();
    result.state?.catalogs.forEach((catalog) => {
      if (catalog.content?.type !== 'Ready') return;
      catalog.content.content.forEach((item) => unique.set(`${item.type}:${item.id}`, item));
    });
    return [...unique.values()];
  }, [deferredQuery, result.state]);

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>{enUS.search.title}</h1>
      <label className={styles.visuallyHidden} htmlFor="catalog-search">
        {enUS.search.placeholder}
      </label>
      <input
        autoFocus
        className={styles.searchInput}
        id="catalog-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={enUS.search.placeholder}
        type="search"
        value={query}
      />
      {deferredQuery ? (
        <p className={styles.searchHelp} role="status">
          {result.loading ? enUS.search.loading : `${items.length} results`}
        </p>
      ) : (
        <p className={styles.searchHelp}>{enUS.search.idle}</p>
      )}
      {result.error ? <p className={styles.loadError}>{enUS.search.error}</p> : null}
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
