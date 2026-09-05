import { useEffect, useMemo } from 'react';

import { Play, X } from '@phosphor-icons/react';

import styles from '../App.module.css';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../components/useActionFeedback';
import { ResourceFailures } from '../components/ResourceFailures';
import { useResourceStates } from '../core/useResourceStates';
import { MediaCard } from '../components/MediaCard';
import { loadBoardAction, rewindLibraryItemAction } from '../core/actions';
import { useCore } from '../core/context';
import { savedTitlePreview } from '../core/preview';
import type { ContinueWatchingItem, CoreMetaPreview } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

const rowItemLimit = 12;

function rowItems(values: CoreMetaPreview[], type: string) {
  return [
    ...new Map(values.filter((item) => item.type === type).map((item) => [item.id, item])).values(),
  ].slice(0, rowItemLimit);
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
  onOpen,
  onResume,
}: {
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
  const values = resources.rows.flatMap((row) => row.value ?? []);
  const typedRows = [
    { id: 'home-movies', items: rowItems(values, 'movie'), title: enUS.home.movies },
    { id: 'home-series', items: rowItems(values, 'series'), title: enUS.home.series },
  ].filter((row) => row.items.length > 0);
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
                <button
                  className={styles.continueOpen}
                  onClick={() => onOpen(savedTitlePreview(item), item.videoId)}
                  type="button"
                >
                  <span className={styles.continueArtwork}>
                    {item.poster ? <img alt="" src={item.poster} /> : null}
                    <span className={styles.continueLabel}>{item.name}</span>
                    <span className={styles.progressTrack}>
                      <span style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                    </span>
                  </span>
                </button>
                <button
                  aria-label={enUS.home.resumeTitle(item.name)}
                  className={styles.continueResume}
                  onClick={() =>
                    onResume ? onResume(item) : onOpen(savedTitlePreview(item), item.videoId)
                  }
                  type="button"
                >
                  <Play aria-hidden size={14} weight="fill" />
                  {enUS.home.resume}
                </button>
                <button
                  aria-label={`${enUS.home.dismiss} ${item.name}`}
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

      {catalogsPending && typedRows.length === 0 ? (
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
      {core.error ? <p className={styles.loadError}>Stremio Core failed: {core.error}</p> : null}
      {!catalogsPending && !board.error && !resources.failures.length && typedRows.length === 0 ? (
        <section className={styles.homeSection} aria-label={enUS.home.catalogs}>
          <h2>{enUS.home.catalogs}</h2>
          <p className={styles.inlineEmpty}>
            {context.loading
              ? 'Loading the guest profile…'
              : context.error
                ? `Guest profile failed: ${context.error}`
                : context.state?.profile.addons.length
                  ? enUS.home.catalogsUnavailable
                  : enUS.home.catalogsEmpty}
          </p>
        </section>
      ) : null}
      {typedRows.map((row) => (
        <section aria-labelledby={`${row.id}-title`} className={styles.homeSection} key={row.id}>
          <h2 id={`${row.id}-title`}>{row.title}</h2>
          <div className={styles.mediaRow}>
            {row.items.map((item) => (
              <MediaCard item={item} key={`${item.type}:${item.id}`} onOpen={() => onOpen(item)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
