import { useEffect, useMemo } from 'react';

import styles from '../App.module.css';
import { MediaCard } from '../components/MediaCard';
import { loadBoardAction } from '../core/actions';
import { useCore } from '../core/context';
import type {
  BoardState,
  ContinueWatchingState,
  CoreMetaPreview,
  ProfileState,
} from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { enUS } from '../locales/en-US';

function RowSkeleton() {
  return (
    <div className={styles.mediaRow} aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.mediaSkeleton} key={index} />
      ))}
    </div>
  );
}

export function HomeScreen({ onOpen }: { onOpen: (item: CoreMetaPreview) => void }) {
  const core = useCore();
  const board = useCoreModel<BoardState>('board', loadBoardAction, 'board');
  const continueWatching = useCoreModel<ContinueWatchingState>(
    'continue_watching_preview',
    null,
    'continue-watching',
  );
  const context = useCoreModel<ProfileState>('ctx', null, 'context');
  const catalogs = board.state?.catalogs ?? [];

  useEffect(() => {
    if (!core.transport || catalogs.length === 0) return;
    void core.transport.dispatch(
      {
        action: 'CatalogsWithExtra',
        args: { action: 'LoadRange', args: { start: 0, end: catalogs.length } },
      },
      'board',
    );
  }, [catalogs.length, core.transport]);

  const readyCatalogs = catalogs.filter(
    (catalog) => catalog.content?.type === 'Ready' && catalog.content.content.length > 0,
  );
  const failedCatalogs = catalogs.some((catalog) => catalog.content?.type === 'Err');
  const loadingCatalogs = catalogs.filter(
    (catalog) => catalog.content === null || catalog.content?.type === 'Loading',
  ).length;
  const catalogsPending = board.loading || (catalogs.length > 0 && loadingCatalogs > 0);
  const continueItems = useMemo(
    () => continueWatching.state?.items.slice(0, 10) ?? [],
    [continueWatching.state],
  );

  return (
    <div className={styles.homePage}>
      <h1 className={styles.visuallyHidden}>{enUS.home.title}</h1>
      <section className={styles.homeSection} aria-labelledby="continue-watching-title">
        <h2 id="continue-watching-title">{enUS.home.continueWatching}</h2>
        {continueWatching.loading ? <RowSkeleton /> : null}
        {!continueWatching.loading && continueItems.length === 0 ? (
          <p className={styles.inlineEmpty}>{enUS.home.continueEmpty}</p>
        ) : null}
        {continueItems.length > 0 ? (
          <div className={styles.continueRow}>
            {continueItems.map((item) => (
              <button
                className={styles.continueCard}
                key={item._id}
                onClick={() =>
                  onOpen({
                    id: item._id,
                    inLibrary: true,
                    name: item.name,
                    ...(item.poster === undefined ? {} : { poster: item.poster }),
                    posterShape: item.posterShape,
                    type: item.type,
                    watched: false,
                  })
                }
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
            ))}
          </div>
        ) : null}
      </section>

      {catalogsPending && readyCatalogs.length === 0 ? (
        <section className={styles.homeSection} aria-label={enUS.home.catalogs}>
          <h2>{enUS.home.catalogs}</h2>
          <RowSkeleton />
        </section>
      ) : null}
      {board.error ? <p className={styles.loadError}>{enUS.home.catalogsError}</p> : null}
      {core.error ? <p className={styles.loadError}>Stremio Core failed: {core.error}</p> : null}
      {!catalogsPending && !board.error && readyCatalogs.length === 0 ? (
        <section className={styles.homeSection} aria-label={enUS.home.catalogs}>
          <h2>{enUS.home.catalogs}</h2>
          <p className={styles.inlineEmpty}>
            {failedCatalogs
              ? enUS.home.catalogsError
              : context.loading
                ? 'Loading the guest profile…'
                : context.error
                  ? `Guest profile failed: ${context.error}`
                  : context.state?.profile.addons.length
                    ? enUS.home.catalogsUnavailable
                    : enUS.home.catalogsEmpty}
          </p>
        </section>
      ) : null}
      {readyCatalogs.map((catalog) => {
        const items = catalog.content?.type === 'Ready' ? catalog.content.content : [];
        return (
          <section
            className={styles.homeSection}
            key={`${catalog.addon.manifest.id}:${catalog.id}`}
          >
            <div className={styles.sectionHeading}>
              <h2>{catalog.name}</h2>
              <span>{catalog.addon.manifest.name}</span>
            </div>
            <div className={styles.mediaRow}>
              {items.map((item) => (
                <MediaCard
                  item={item}
                  key={`${item.type}:${item.id}`}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
