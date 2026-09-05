import { useEffect, useMemo } from 'react';

import styles from '../App.module.css';
import { ResourceFailures } from '../components/ResourceFailures';
import { useResourceStates } from '../core/useResourceStates';
import { MediaCard } from '../components/MediaCard';
import { loadSearchAction } from '../core/actions';
import { useCore } from '../core/context';
import type { CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { useBrowseState } from '../navigation';

export function SearchScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const { transport } = useCore();
  const [{ query, submittedQuery }, setSearch] = useBrowseState('search');
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery === submittedQuery) return;
    const timer = window.setTimeout(
      () => setSearch((previous) => ({ ...previous, submittedQuery: normalizedQuery })),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, submittedQuery, setSearch]);

  const result = useCoreModel(
    'search',
    submittedQuery ? loadSearchAction(submittedQuery) : null,
    submittedQuery,
  );
  const stateQuery = result.state?.selected?.extra.find(([name]) => name === 'search')?.[1];
  const currentState = submittedQuery && stateQuery === submittedQuery ? result.state : null;
  const catalogCount = currentState?.catalogs.length ?? 0;
  const pending = normalizedQuery !== submittedQuery;

  useEffect(() => {
    if (!transport || result.loading || !submittedQuery || catalogCount === 0) return;
    void transport
      .dispatch(
        {
          action: 'CatalogsWithExtra',
          args: { action: 'LoadRange', args: { start: 0, end: catalogCount } },
        },
        'search',
      )
      .catch(() => undefined);
  }, [catalogCount, result.loading, submittedQuery, transport]);
  const inputs = useMemo(
    () =>
      currentState?.catalogs.map((catalog, index) => ({
        id: JSON.stringify([index, catalog.addon.manifest.id, catalog.type, catalog.id]),
        name: catalog.addon.manifest.name,
        content: catalog.content,
      })) ?? null,
    [currentState],
  );
  const resources = useResourceStates(transport, submittedQuery, inputs, result.loading);
  const items =
    pending || !submittedQuery
      ? []
      : [
          ...new Map(
            resources.rows
              .flatMap((resource) => resource.value ?? [])
              .map((item) => [`${item.type}:${item.id}`, item]),
          ).values(),
        ];
  const searching = pending || (!result.error && resources.pending);

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>{enUS.search.title}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSearch((previous) => ({ ...previous, submittedQuery: normalizedQuery }));
        }}
        role="search"
      >
        <label className={styles.visuallyHidden} htmlFor="catalog-search">
          {enUS.search.placeholder}
        </label>
        <input
          className={styles.searchInput}
          id="catalog-search"
          onChange={(event) => {
            const value = event.target.value;
            setSearch((previous) => ({
              query: value,
              submittedQuery: value.trim() ? previous.submittedQuery : '',
            }));
          }}
          placeholder={enUS.search.placeholder}
          type="search"
          value={query}
        />
      </form>
      {normalizedQuery ? (
        <p className={styles.searchHelp} role="status">
          {searching
            ? items.length
              ? enUS.search.partial(items.length)
              : enUS.search.loading
            : result.error || (resources.failures.length && !items.length)
              ? enUS.search.error
              : enUS.search.count(items.length)}
        </p>
      ) : (
        <p className={styles.searchHelp}>{enUS.search.idle}</p>
      )}
      {!pending && submittedQuery ? (
        <ResourceFailures
          names={resources.failures}
          error={result.error ? enUS.search.error : null}
          pending={searching}
          onRetry={result.retry}
        />
      ) : null}
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
