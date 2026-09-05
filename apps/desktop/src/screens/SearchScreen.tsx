import { useEffect, useMemo, useState } from 'react';

import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { loadSearchAction } from '../core/actions';
import { useCore } from '../core/context';
import type { BoardState, CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

export function SearchScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const { transport } = useCore();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery === submittedQuery) return;
    const timer = window.setTimeout(() => setSubmittedQuery(normalizedQuery), 300);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, submittedQuery]);

  const result = useCoreModel<BoardState>(
    'search',
    submittedQuery ? loadSearchAction(submittedQuery) : null,
    submittedQuery,
  );
  const stateQuery = result.state?.selected?.extra.find(([name]) => name === 'search')?.[1];
  const currentState = submittedQuery && stateQuery === submittedQuery ? result.state : null;
  const catalogCount = currentState?.catalogs.length ?? 0;
  const pending = normalizedQuery !== submittedQuery;

  useEffect(() => {
    if (!transport || !submittedQuery || catalogCount === 0) return;
    void transport.dispatch(
      {
        action: 'CatalogsWithExtra',
        args: { action: 'LoadRange', args: { start: 0, end: catalogCount } },
      },
      'search',
    );
  }, [catalogCount, submittedQuery, transport]);
  const items = useMemo(() => {
    if (pending || !submittedQuery) return [];
    const unique = new Map<string, CoreMetaPreview>();
    currentState?.catalogs.forEach((catalog) => {
      if (catalog.content?.type !== 'Ready') return;
      catalog.content.content.forEach((item) => unique.set(`${item.type}:${item.id}`, item));
    });
    return [...unique.values()];
  }, [currentState, pending, submittedQuery]);

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>{enUS.search.title}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(normalizedQuery);
        }}
        role="search"
      >
        <label className={styles.visuallyHidden} htmlFor="catalog-search">
          {enUS.search.placeholder}
        </label>
        <input
          autoFocus
          className={styles.searchInput}
          id="catalog-search"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (!value.trim()) setSubmittedQuery('');
          }}
          placeholder={enUS.search.placeholder}
          type="search"
          value={query}
        />
      </form>
      {normalizedQuery ? (
        <p className={styles.searchHelp} role="status">
          {pending || result.loading ? enUS.search.loading : `${items.length} results`}
        </p>
      ) : (
        <p className={styles.searchHelp}>{enUS.search.idle}</p>
      )}
      {!pending && result.error ? <p className={styles.loadError}>{enUS.search.error}</p> : null}
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
