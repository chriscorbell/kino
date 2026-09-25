import { useEffect, useMemo } from 'react';

import { CaretRight, X } from '@phosphor-icons/react';

import styles from '../App.module.css';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../components/useActionFeedback';
import { ResourceFailures } from '../components/ResourceFailures';
import { useResourceStates } from '../core/useResourceStates';
import { MediaCard } from '../components/MediaCard';
import { loadBoardAction, rewindLibraryItemAction } from '../core/actions';
import { useCore } from '../core/context';
import { savedTitlePreview } from '../core/preview';
import type {
  CatalogRequest,
  ContinueWatchingItem,
  CoreCatalog,
  CoreMetaPreview,
} from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

const rowItemLimit = 12;

function rowItems(values: CoreMetaPreview[]) {
  return [...new Map(values.map((item) => [`${item.type}:${item.id}`, item])).values()].slice(
    0,
    rowItemLimit,
  );
}

// Kino plays movies and series; other catalog types, such as YouTube
// channels, have nothing it can open from Home.
const homeTypes = { movie: enUS.home.movies, series: enUS.home.series } as Record<string, string>;

// Each add-on catalog is its own row, named as the add-on names it, with its
// type unless the name already says it. Two rows that would read the same
// also show which add-on each comes from.
function rowTitles(catalogs: CoreCatalog[]) {
  const titles = catalogs.map((catalog) => `${catalog.name}\u0000${catalog.type}`);
  return catalogs.map((catalog, index) => {
    const type = homeTypes[catalog.type] ?? '';
    const named = catalog.name.toLowerCase().includes(catalog.type);
    const source =
      titles.indexOf(titles[index]!) !== titles.lastIndexOf(titles[index]!)
        ? catalog.addon.manifest.name
        : null;
    return {
      name: catalog.name,
      detail: [named ? null : type, source].filter(Boolean).join(' · '),
    };
  });
}

function RowSkeleton() {
  return (
    <div className={styles.mediaRow} aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.mediaSkeleton} key={index} />
      ))}
    </div>
  );
}

export function HomeScreen({
  onDiscover,
  onOpen,
  onResume,
}: {
  onDiscover?: (request: CatalogRequest) => void;
  onOpen: (item: CoreMetaPreview, videoId?: string | null) => void;
  onResume?: (item: ContinueWatchingItem) => void;
}) {
  const core = useCore();
  const dismissal = useActionFeedback(core.transport);
  const board = useCoreModel('board', loadBoardAction, 'board');
  const continueWatching = useCoreModel('continue_watching_preview', null, 'continue-watching');
  const context = useCoreModel('ctx', null, 'context');
  const catalogs = board.state?.catalogs ?? [];

  useEffect(() => {
    if (!core.transport || board.loading || catalogs.length === 0) return;
    void core.transport
      .dispatch(
        {
          action: 'CatalogsWithExtra',
          args: { action: 'LoadRange', args: { start: 0, end: catalogs.length } },
        },
        'board',
      )
      .catch(() => undefined);
  }, [board.loading, catalogs.length, core.transport]);

  const inputs = useMemo(
    () =>
      board.state?.catalogs.map((catalog, index) => ({
        id: JSON.stringify([index, catalog.addon.manifest.id, catalog.type, catalog.id]),
        name: catalog.addon.manifest.name,
        content: catalog.content,
      })) ?? null,
    [board.state],
  );
  const resources = useResourceStates(core.transport, 'board', inputs, board.loading);
  const titles = rowTitles(catalogs);
  // Rows follow Core's board order. A loading row keeps its place with a
  // placeholder; an empty or failed one drops out, and failures are named below.
  const catalogRows = resources.rows.flatMap((row, index) => {
    const catalog = catalogs[index];
    const title = titles[index];
    if (!catalog || !title || !(catalog.type in homeTypes)) return [];
    const items = rowItems(row.value ?? []);
    const loading = items.length === 0 && (!row.content || row.content.type === 'Loading');
    if (items.length === 0 && !loading) return [];
    return [{ id: `home-catalog-${index}`, items, loading, request: catalog.request, title }];
  });
  const shownRows = catalogRows.filter((row) => row.items.length > 0);
  const catalogsPending = !board.error && resources.pending;
  const continueItems = useMemo(
    () => continueWatching.state?.items.slice(0, 10) ?? [],
    [continueWatching.state],
  );

  const dismissContinueWatching = (id: string, name: string) => {
    const transport = core.transport;
    if (!transport) return;
    dismissal.run(
      async () => {
        await transport.dispatch(rewindLibraryItemAction(id));
        await transport.flush();
      },
      {
        pending: enUS.home.dismissing(name),
        success: enUS.home.dismissed(name),
        failed: enUS.home.dismissFailed(name),
      },
    );
  };

  return (
    <div className={styles.homePage}>
      <h1 className={styles.visuallyHidden}>{enUS.home.title}</h1>
      <section className={styles.homeSection} aria-labelledby="continue-watching-title">
        <h2 id="continue-watching-title">{enUS.home.continueWatching}</h2>
        {continueWatching.loading ? <RowSkeleton /> : null}
        {!continueWatching.loading && !continueWatching.error && continueItems.length === 0 ? (
          <p className={styles.inlineEmpty}>{enUS.home.continueEmpty}</p>
        ) : null}
        {continueItems.length > 0 ? (
          <div className={styles.continueRow}>
            {continueItems.map((item) => (
              <div className={styles.continueCard} key={item.id}>
                <MediaCard
                  item={savedTitlePreview(item)}
                  resumeProgress={item.progress}
                  onOpen={() =>
                    onResume ? onResume(item) : onOpen(savedTitlePreview(item), item.videoId)
                  }
                />
                <button
                  aria-label={enUS.home.dismissTitle(item.name)}
                  className={styles.continueDismiss}
                  disabled={dismissal.pending}
                  aria-busy={dismissal.pending}
                  onClick={() => dismissContinueWatching(item.id, item.name)}
                  title={enUS.home.dismiss}
                  type="button"
                >
                  <X aria-hidden size={14} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <ActionFeedback action={dismissal} />
      </section>

      {catalogsPending && catalogRows.length === 0 ? (
        <section className={styles.homeSection} aria-label={enUS.home.catalogs}>
          <h2>{enUS.home.catalogs}</h2>
          <RowSkeleton />
        </section>
      ) : null}
      {catalogsPending ? (
        <p role="status" className={styles.inlineEmpty}>
          {enUS.home.loadingCatalogs}
        </p>
      ) : null}
      <ResourceFailures
        names={resources.failures}
        error={board.error ? enUS.home.catalogsError : null}
        pending={catalogsPending}
        onRetry={board.retry}
      />
      {core.error ? <p className={styles.loadError}>{enUS.core.failed(core.error)}</p> : null}
      {!catalogsPending && !board.error && !resources.failures.length && shownRows.length === 0 ? (
        <section className={styles.homeSection} aria-label={enUS.home.catalogs}>
          <h2>{enUS.home.catalogs}</h2>
          <p className={styles.inlineEmpty}>
            {context.loading
              ? enUS.core.guestLoading
              : context.error
                ? enUS.core.guestFailed(context.error)
                : context.state?.profile.addons.length
                  ? enUS.home.catalogsUnavailable
                  : enUS.home.catalogsEmpty}
          </p>
        </section>
      ) : null}
      {catalogRows.map((row) => (
        <section aria-labelledby={`${row.id}-title`} className={styles.homeSection} key={row.id}>
          <div className={styles.homeSectionHeading}>
            <h2 id={`${row.id}-title`}>
              {row.title.name}
              {row.title.detail ? <span> {row.title.detail}</span> : null}
            </h2>
            {row.request && onDiscover && !row.loading ? (
              <button
                aria-label={enUS.home.seeAllTitle(
                  [row.title.name, row.title.detail].filter(Boolean).join(' '),
                )}
                className={styles.seeAll}
                onClick={() => onDiscover(row.request!)}
                type="button"
              >
                {enUS.home.seeAll}
                <CaretRight aria-hidden size={14} />
              </button>
            ) : null}
          </div>
          {row.loading ? (
            <RowSkeleton />
          ) : (
            <div className={styles.mediaRow}>
              {row.items.map((item) => (
                <MediaCard
                  item={item}
                  key={`${item.type}:${item.id}`}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
