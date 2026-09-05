import { ArrowLeft, Check, Play, Plus } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import {
  addToLibraryAction,
  loadMetaDetailsAction,
  removeFromLibraryAction,
  type PlaybackSelection,
} from '../core/actions';
import { useCore } from '../core/context';
import { classifySource, sourceDetails, sourceKey, sourceSize, sourceTitle } from '../core/sources';
import type {
  CoreMetaItem,
  CoreMetaPreview,
  CoreStream,
  CoreVideo,
  MetaDetailsState,
} from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

interface SourceChoice {
  addonName: string;
  stream: CoreStream;
  transportUrl: string;
}

function metadata(item: CoreMetaItem) {
  return [item.releaseInfo, item.runtime, item.type === 'series' ? 'Series' : 'Movie']
    .filter(Boolean)
    .join(' · ');
}

function defaultVideoId(item: CoreMetaPreview) {
  const value = item.behaviorHints?.defaultVideoId;
  return typeof value === 'string' ? value : null;
}

export function MetaDetailsScreen({
  failedSources,
  initialVideoId,
  item,
  onBack,
  onPlay,
}: {
  failedSources: ReadonlyMap<string, string>;
  initialVideoId?: string | null;
  item: CoreMetaPreview;
  onBack: () => void;
  onPlay: (selection: PlaybackSelection) => void;
}) {
  const { transport } = useCore();
  const [videoId, setVideoId] = useState<string | null>(
    () => initialVideoId ?? defaultVideoId(item),
  );
  const [libraryOverride, setLibraryOverride] = useState<boolean | null>(null);
  const result = useCoreModel<MetaDetailsState>(
    'meta_details',
    loadMetaDetailsAction(item, videoId),
    `${item.type}:${item.id}:${videoId ?? 'guess'}`,
  );
  const resource = result.state?.metaItem;
  const loadedMeta =
    resource?.content.type === 'Ready' &&
    resource.content.content.id === item.id &&
    resource.content.content.type === item.type
      ? resource.content.content
      : null;
  // Choosing an episode reloads the model, and the reloaded state arrives with
  // its metadata still loading. Without the previous copy the episode list
  // unmounts, the page collapses to the hero, and the browser discards the
  // scroll position. The screen is keyed by title, so this cannot leak between
  // titles, and a title's metadata does not change when only the episode does.
  const [lastMeta, setLastMeta] = useState<CoreMetaItem | null>(null);
  if (loadedMeta && loadedMeta !== lastMeta) setLastMeta(loadedMeta);
  const meta = loadedMeta ?? lastMeta;
  const videos = useMemo(() => meta?.videos ?? [], [meta]);
  const sourcesRef = useRef<HTMLElement>(null);
  const episodeChosenRef = useRef(false);

  useEffect(() => {
    if (item.type !== 'series' || videoId !== null || videos.length === 0) return;
    const firstEpisode = videos.find((video) => (video.season ?? 0) > 0) ?? videos[0];
    if (!firstEpisode) return;
    const timeout = window.setTimeout(() => setVideoId(firstEpisode.id), 0);
    return () => window.clearTimeout(timeout);
  }, [item.type, videoId, videos]);

  const seasons = useMemo(
    () => [...new Set(videos.map((video) => video.season).filter((value) => value !== undefined))],
    [videos],
  );
  const activeVideo =
    videos.find((video) => video.id === videoId) ??
    videos.find((video) => (video.season ?? 0) > 0) ??
    videos[0] ??
    null;
  const activeSeason = activeVideo?.season ?? seasons[0];
  const visibleVideos = videos.filter((video) => video.season === activeSeason);
  const selected = result.state?.selected;
  // The hook retains old state during Load, and NewState reads can arrive late.
  // Core's selected paths identify the streams in this snapshot. They must also
  // match the identity that PlaybackSelection will send to the player.
  const sourcesCurrent =
    !result.loading &&
    Boolean(loadedMeta) &&
    selected?.metaPath.resource === 'meta' &&
    selected.metaPath.type === item.type &&
    selected.metaPath.id === item.id &&
    selected.streamPath?.resource === 'stream' &&
    selected.streamPath.type === item.type &&
    selected.streamPath.id === (videoId ?? activeVideo?.id ?? item.id) &&
    selected.streamPath.id === (activeVideo?.id ?? item.id);

  // Wait for this episode's snapshot before moving the source list into view.
  useEffect(() => {
    if (!episodeChosenRef.current || !sourcesCurrent) return;
    episodeChosenRef.current = false;
    sourcesRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [sourcesCurrent, videoId]);

  const sources = useMemo<SourceChoice[]>(
    () =>
      result.state?.streams.flatMap((sourceResource) =>
        sourceResource.content.type === 'Ready'
          ? sourceResource.content.content.map((stream) => ({
              addonName: sourceResource.addon.manifest.name,
              stream,
              transportUrl: sourceResource.addon.transportUrl ?? '',
            }))
          : [],
      ) ?? [],
    [result.state],
  );
  const display = meta ?? item;
  const activeIndex = activeVideo ? videos.findIndex((video) => video.id === activeVideo.id) : -1;
  const nextEpisode = activeIndex >= 0 ? (videos[activeIndex + 1] ?? null) : null;
  const inLibrary = libraryOverride ?? display.inLibrary;

  const toggleLibrary = () => {
    if (!transport) return;
    const next = !inLibrary;
    setLibraryOverride(next);
    void transport
      .dispatch(next ? addToLibraryAction(display) : removeFromLibraryAction(display.id))
      .catch((error: unknown) => {
        setLibraryOverride(!next);
        console.error(
          '[kino:library] update failed',
          error instanceof Error ? error.message : error,
        );
      });
  };

  return (
    <div className={styles.detailPage}>
      <header className={styles.detailHero}>
        {display.background ? (
          <img alt="" className={styles.detailBackdrop} src={display.background} />
        ) : null}
        <div className={styles.detailShade} />
        <button className={styles.backButton} onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={16} />
          {enUS.actions.back}
        </button>
        <div className={styles.detailCopy}>
          <h1>{display.name}</h1>
          <p className={styles.detailMetadata}>{metadata(display as CoreMetaItem)}</p>
          {display.description ? (
            <p className={styles.detailDescription}>{display.description}</p>
          ) : null}
          <button className={styles.libraryButton} onClick={toggleLibrary} type="button">
            {inLibrary ? <Check aria-hidden size={16} /> : <Plus aria-hidden size={16} />}
            {inLibrary ? enUS.details.inLibrary : enUS.details.addToLibrary}
          </button>
        </div>
      </header>

      <div className={styles.detailBody}>
        {result.loading && !meta ? (
          <p className={styles.inlineEmpty}>{enUS.details.loading}</p>
        ) : null}
        {result.error ? <p className={styles.loadError}>{enUS.details.error}</p> : null}
        {item.type === 'series' && videos.length > 0 ? (
          <section className={styles.detailSection} aria-labelledby="episodes-heading">
            <div className={styles.detailSectionHeading}>
              <h2 id="episodes-heading">{enUS.details.episodes}</h2>
              <div className={styles.seasonTabs}>
                {seasons.map((season) => (
                  <button
                    aria-pressed={season === activeSeason}
                    className={season === activeSeason ? styles.seasonActive : styles.seasonButton}
                    key={season}
                    onClick={() => {
                      const first = videos.find((video) => video.season === season);
                      if (first) setVideoId(first.id);
                    }}
                    type="button"
                  >
                    Season {season}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.episodeList}>
              {visibleVideos.map((video: CoreVideo) => (
                <button
                  aria-current={video.id === videoId ? 'true' : undefined}
                  className={video.id === videoId ? styles.episodeActive : styles.episodeButton}
                  key={video.id}
                  onClick={() => {
                    episodeChosenRef.current = true;
                    setVideoId(video.id);
                  }}
                  type="button"
                >
                  <span className={styles.episodeNumber}>
                    {String(video.episode ?? 0).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{video.title || `Episode ${video.episode}`}</strong>
                    {video.overview ? <small>{video.overview}</small> : null}
                  </span>
                  <Play aria-hidden size={16} weight="fill" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section
          aria-labelledby="sources-heading"
          className={styles.detailSection}
          ref={sourcesRef}
        >
          <div className={styles.detailSectionHeading}>
            <h2 id="sources-heading">{enUS.details.sources}</h2>
            {!sourcesCurrent && !result.error ? <span>{enUS.details.refreshing}</span> : null}
          </div>
          {failedSources.size > 0 ? (
            <p className={styles.loadError} role="status">
              {[...failedSources.values()].at(-1)}
            </p>
          ) : null}
          {sourcesCurrent && sources.length === 0 ? (
            <p className={styles.inlineEmpty}>{enUS.details.noSources}</p>
          ) : null}
          <div className={styles.sourceList}>
            {sources.map((source, index) => {
              const support = classifySource(source.stream);
              const playable =
                (support === 'direct' || support === 'torrent') && Boolean(source.transportUrl);
              const failed = failedSources.has(sourceKey(source.stream, source.transportUrl));
              return (
                <button
                  className={styles.sourceButton}
                  disabled={!playable || !sourcesCurrent}
                  key={`${source.transportUrl}:${index}`}
                  onClick={() => {
                    if (!sourcesCurrent || !playable || !resource?.addon.transportUrl) return;
                    onPlay({
                      meta: display,
                      metaTransportUrl: resource.addon.transportUrl,
                      nextVideo: nextEpisode,
                      stream: source.stream,
                      streamTransportUrl: source.transportUrl,
                      video: activeVideo,
                    });
                  }}
                  type="button"
                >
                  <span className={styles.sourcePrimary}>
                    <strong>{sourceTitle(source.stream)}</strong>
                    <small>{sourceDetails(source.stream)}</small>
                  </span>
                  <span className={styles.sourceMeta}>
                    {sourceSize(source.stream) ? <span>{sourceSize(source.stream)}</span> : null}
                    <span>{source.addonName}</span>
                    {!playable ? <em>{enUS.details.unavailable}</em> : null}
                    {playable && failed ? <em>{enUS.details.failed}</em> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
