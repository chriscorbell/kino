import { ArrowLeft, CaretRight, Check, Plus } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { EpisodeSourcesScreen } from './EpisodeSourcesScreen';
import { availableSeasons, initialSeason, seasonEpisodes } from '../core/seasons';
import { ResumeCover } from '../components/ResumeCover';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../components/useActionFeedback';
import { ResourceFailures } from '../components/ResourceFailures';
import { useResourceStates } from '../core/useResourceStates';
import { ExternalSourceDialog } from '../components/ExternalSourceDialog';
import { ExpandableText } from '../components/ExpandableText';
import {
  addToLibraryAction,
  loadMetaDetailsAction,
  removeFromLibraryAction,
  type PlaybackSelection,
} from '../core/actions';
import { useCore } from '../core/context';
import { checkResumeSource, type ResumeRequest } from '../core/resume';
import { sourceFields, withEstimatedBitrate } from '../core/sourceFields';
import {
  classifySource,
  externalWebUrl,
  sourceKey,
  unsupportedSourceReason,
} from '../core/sources';
import { SourceRow } from '../components/SourceRow';
import type { CoreMetaItem, CoreMetaPreview, CoreSource, CoreVideo } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

interface SourceChoice {
  current: boolean;
  addonName: string;
  source: CoreSource;
  transportUrl: string;
}

function metadata(item: CoreMetaPreview) {
  return [
    item.releaseInfo,
    item.runtime,
    item.type === 'series' ? enUS.media.series : enUS.media.movie,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MetaDetailsScreen({
  failedSources,
  initialVideoId,
  item,
  onBack,
  onPlay,
  resumeRequest = null,
  onCancelResume,
  navigation,
}: {
  failedSources: ReadonlyMap<string, string>;
  initialVideoId?: string | null;
  item: CoreMetaPreview;
  onBack: () => void;
  onPlay: (selection: PlaybackSelection) => void;
  resumeRequest?: ResumeRequest | null;
  onCancelResume?: () => void;
  navigation?:
    | {
        videoId: string | null;
        season: number | null | undefined;
        selectVideo: (id: string | null) => void;
        selectSeason: (season: number | null) => void;
      }
    | undefined;
}) {
  const { transport } = useCore();
  const libraryAction = useActionFeedback(transport);
  const [localVideoId, setLocalVideoId] = useState<string | null>(
    () => initialVideoId ?? (item.type === 'series' ? null : item.defaultVideoId),
  );
  const videoId = navigation ? navigation.videoId : localVideoId;
  const setVideoId = navigation?.selectVideo ?? setLocalVideoId;
  const [localSeason, setLocalSeason] = useState<number | null | undefined>(undefined);
  const chosenSeason = navigation ? navigation.season : localSeason;
  const setSeason = navigation?.selectSeason ?? setLocalSeason;
  const [profileTransport, setProfileTransport] = useState(transport);
  const [libraryOverride, setLibraryOverride] = useState<{ value: boolean } | null>(null);
  const result = useCoreModel(
    'meta_details',
    loadMetaDetailsAction(item, videoId),
    `${item.type}:${item.id}:${videoId ?? 'guess'}`,
  );
  const checkedResume = useRef<ResumeRequest | null>(null);
  const checkingResume = Boolean(resumeRequest);
  useEffect(() => {
    if (!resumeRequest || checkedResume.current === resumeRequest) return;
    const decision =
      resumeRequest.transport === transport
        ? checkResumeSource(resumeRequest.item, result.state, result.loading, result.error)
        : 'unavailable';
    if (decision === 'pending') return;
    checkedResume.current = resumeRequest;
    if (decision === 'unavailable') onCancelResume?.();
    else onPlay(decision);
  }, [
    onPlay,
    onCancelResume,
    result.error,
    result.loading,
    result.state,
    resumeRequest,
    transport,
  ]);
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
  // titles. Profile changes clear it because metadata also includes library
  // membership and progress that belong to that Core transport.
  const [lastMeta, setLastMeta] = useState<CoreMetaItem | null>(null);
  if (profileTransport !== transport) {
    setProfileTransport(transport);
    setLibraryOverride(null);
    setLastMeta(loadedMeta);
    setLocalSeason(undefined);
    setLocalVideoId(null);
  } else if (loadedMeta && loadedMeta !== lastMeta) setLastMeta(loadedMeta);
  const meta = loadedMeta ?? (profileTransport === transport ? lastMeta : null);
  const videos = useMemo(() => meta?.videos ?? [], [meta]);
  const seasons = useMemo(() => availableSeasons(videos), [videos]);
  const progress = result.state?.libraryItem?.id === item.id ? result.state.libraryItem : null;
  const activeSeason = chosenSeason !== undefined ? chosenSeason : initialSeason(videos, progress);
  useLayoutEffect(() => {
    if (item.type === 'series' && loadedMeta && chosenSeason === undefined) {
      const selectedVideo = loadedMeta.videos.find((video) => video.id === videoId);
      setSeason(selectedVideo ? selectedVideo.season : initialSeason(loadedMeta.videos, progress));
    }
  }, [chosenSeason, item.type, loadedMeta, progress, setSeason, videoId]);
  const activeVideo = videos.find((video) => video.id === videoId) ?? null;
  const sourcePage = item.type === 'series' && videoId !== null;
  const visibleVideos = seasonEpisodes(videos, activeSeason);
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

  const streamInputs = useMemo(
    () =>
      result.state &&
      result.state.streams.length === 0 &&
      (!result.state.metaItem || result.state.metaItem.content.type === 'Loading')
        ? null
        : (result.state?.streams.map((resource, index) => ({
            id: JSON.stringify([index, resource.addon.transportUrl, resource.addon.manifest.id]),
            name: resource.addon.manifest.name,
            content:
              resource.content.type === 'Ready'
                ? {
                    type: 'Ready' as const,
                    content: resource.content.content.map((source) => ({
                      addonName: resource.addon.manifest.name,
                      source,
                      transportUrl: resource.addon.transportUrl ?? '',
                      current: true,
                    })),
                  }
                : resource.content,
          })) ?? null),
    [result.state],
  );
  const streamResources = useResourceStates(
    transport,
    selected?.streamPath ? `${item.type}:${item.id}:${selected.streamPath.id}` : null,
    streamInputs,
    result.loading,
  );
  const sources: SourceChoice[] = streamResources.rows.flatMap((row) =>
    (row.value ?? []).map((choice) => ({ ...choice, current: row.current })),
  );
  const metaFailed = resource?.content.type === 'Err';
  const sourcesPending =
    !result.error && !metaFailed && (!sourcesCurrent || streamResources.pending);
  const failures = [
    ...(metaFailed ? [resource.addon.manifest.name] : []),
    ...streamResources.failures,
  ];

  const display = meta ?? item;
  const sourceSelection = { meta: display, video: activeVideo };
  const visibleSourceKeys = new Set(
    sources
      .filter((choice) => choice.current)
      .map((choice) => sourceKey(choice.source, choice.transportUrl, sourceSelection)),
  );
  const [externalChoice, setExternalChoice] = useState<{
    key: string;
    url: URL;
    transport: typeof transport;
  } | null>(null);
  const currentExternal =
    externalChoice &&
    sourcesCurrent &&
    externalChoice.transport === transport &&
    visibleSourceKeys.has(externalChoice.key)
      ? externalChoice
      : null;
  if (externalChoice && !currentExternal) setExternalChoice(null);
  const currentFailure = sourcesCurrent
    ? [...failedSources].findLast(([key]) => visibleSourceKeys.has(key))?.[1]
    : null;
  const activeIndex = activeVideo ? videos.findIndex((video) => video.id === activeVideo.id) : -1;
  const nextEpisode = activeIndex >= 0 ? (videos[activeIndex + 1] ?? null) : null;
  const inLibrary = libraryOverride?.value ?? display.inLibrary;
  const libraryReady = Boolean(transport && meta);
  const chooseVideo = (id: string) => {
    onCancelResume?.();
    setVideoId(id);
  };

  const toggleLibrary = () => {
    if (!transport || !libraryReady) return;
    const next = !inLibrary;
    const change = { value: next };
    libraryAction.run(
      async () => {
        setLibraryOverride(change);
        try {
          await transport.dispatch(
            next ? addToLibraryAction(display) : removeFromLibraryAction(display.id),
          );
          await transport.flush();
        } catch (error) {
          // A late failure must not overwrite another profile's action.
          setLibraryOverride((current) => (current === change ? null : current));
          throw error;
        }
      },
      {
        pending: enUS.details.savingLibrary,
        success: next ? enUS.details.libraryAdded : enUS.details.libraryRemoved,
        failed: enUS.details.libraryFailed,
      },
    );
  };

  const sourceSection = (
    <section aria-labelledby="sources-heading" className={styles.detailSection}>
      <ResourceFailures
        names={failures}
        error={result.error ? enUS.details.error : null}
        pending={sourcesPending}
        onRetry={result.retry}
      />
      <div className={styles.detailSectionHeading}>
        <h2 id="sources-heading">{enUS.details.sources}</h2>
        {sourcesPending ? <span role="status">{enUS.details.refreshing}</span> : null}
      </div>
      {currentFailure ? (
        <p className={styles.loadError} role="status">
          {currentFailure}
        </p>
      ) : null}
      {sourcesCurrent &&
      !sourcesPending &&
      !result.error &&
      failures.length === 0 &&
      sources.length === 0 ? (
        <p role="status" className={styles.inlineEmpty}>
          {enUS.details.noSources}
        </p>
      ) : null}
      <div className={styles.sourceList}>
        {sources.map((choice, index) => {
          const support = classifySource(choice.source.source);
          const playable =
            (support === 'direct' || support === 'torrent') && Boolean(choice.transportUrl);
          const external =
            choice.source.source.kind === 'external'
              ? externalWebUrl(choice.source.source.externalUrl)
              : null;
          const selectable = playable || Boolean(external);
          const key = sourceKey(choice.source, choice.transportUrl, sourceSelection);
          const failed = failedSources.has(key);
          const unavailable =
            support === 'direct' || support === 'torrent'
              ? enUS.details.sourceUnsupported.addon
              : enUS.details.sourceUnsupported[unsupportedSourceReason(choice.source.source)];
          const fields = withEstimatedBitrate(sourceFields(choice.source), display.runtime);
          return (
            <SourceRow
              addonName={choice.addonName}
              disabled={!selectable || !sourcesCurrent || !choice.current}
              external={external}
              failed={playable && failed}
              fields={fields}
              key={`${choice.transportUrl}:${index}`}
              playable={playable}
              selectable={selectable}
              unavailable={unavailable}
              onSelect={() => {
                if (!sourcesCurrent || !choice.current) return;
                if (external) {
                  setExternalChoice({ key, url: external, transport });
                  return;
                }
                if (!playable || !resource?.addon.transportUrl) return;
                onPlay({
                  meta: display,
                  metaTransportUrl: resource.addon.transportUrl,
                  nextVideo: nextEpisode,
                  stream: choice.source,
                  streamTransportUrl: choice.transportUrl,
                  video: activeVideo,
                });
              }}
            />
          );
        })}
      </div>
    </section>
  );

  return (
    <div className={styles.detailPage}>
      <div hidden={sourcePage}>
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
            <p className={styles.detailMetadata}>{metadata(display)}</p>
            {display.description ? (
              <ExpandableText
                className={styles.detailDescription}
                key={display.description}
                label={display.name}
                lines={3}
                text={display.description}
              />
            ) : null}
            <button
              className={styles.libraryButton}
              disabled={!libraryReady || libraryAction.pending}
              aria-busy={libraryAction.pending}
              onClick={toggleLibrary}
              type="button"
            >
              {libraryReady ? (
                inLibrary ? (
                  <Check aria-hidden size={16} />
                ) : (
                  <Plus aria-hidden size={16} />
                )
              ) : null}
              {!libraryReady
                ? enUS.details.loadingLibrary
                : inLibrary
                  ? enUS.details.inLibrary
                  : enUS.details.addToLibrary}
            </button>
            <ActionFeedback action={libraryAction} />
          </div>
        </header>

        <div className={styles.detailBody}>
          {!result.error && !metaFailed && !meta ? (
            <p role="status" className={styles.inlineEmpty}>
              {enUS.details.loading}
            </p>
          ) : null}
          {item.type === 'series' ? (
            <ResourceFailures
              names={metaFailed ? [resource.addon.manifest.name] : []}
              error={result.error ? enUS.details.error : null}
              pending={!meta}
              onRetry={result.retry}
            />
          ) : null}
          {item.type === 'series' && videos.length > 0 ? (
            <section className={styles.detailSection} aria-labelledby="episodes-heading">
              <div className={styles.detailSectionHeading}>
                <h2 id="episodes-heading">{enUS.details.episodes}</h2>
                <label className={styles.seasonSelector}>
                  <span className={styles.visuallyHidden}>{enUS.details.selectSeason}</span>
                  <select
                    value={activeSeason === null ? 'none' : String(activeSeason)}
                    onChange={(event) =>
                      setSeason(event.target.value === 'none' ? null : Number(event.target.value))
                    }
                  >
                    {seasons.map((season) => (
                      <option
                        key={String(season)}
                        value={season === null ? 'none' : String(season)}
                      >
                        {season === null
                          ? enUS.details.otherEpisodes
                          : season === 0
                            ? enUS.details.specials
                            : enUS.details.season(season)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.episodeList}>
                {visibleVideos.map((video: CoreVideo) => (
                  <div
                    className={`${styles.episodeRow} ${video.id === videoId ? styles.episodeActive : ''}`}
                    key={video.id}
                  >
                    <button
                      aria-current={video.id === videoId ? 'true' : undefined}
                      data-episode-id={video.id}
                      className={styles.episodeButton}
                      onClick={() => {
                        chooseVideo(video.id);
                      }}
                      type="button"
                    >
                      <span className={styles.episodeNumber}>
                        {String(video.episode ?? 0).padStart(2, '0')}
                      </span>
                      <span className={styles.episodeText}>
                        <strong>{video.title || enUS.details.episode(video.episode)}</strong>
                        {video.watched ? (
                          <span>{enUS.details.watched}</span>
                        ) : progress?.videoId === video.id && progress.timeOffset > 0 ? (
                          <span>{enUS.details.inProgress}</span>
                        ) : null}
                      </span>
                      <CaretRight aria-hidden size={16} />
                    </button>
                    {video.overview ? (
                      <ExpandableText
                        className={styles.episodeOverview}
                        key={video.overview}
                        label={video.title || enUS.details.episode(video.episode)}
                        lines={1}
                        text={video.overview}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {item.type !== 'series' ? sourceSection : null}
        </div>
      </div>
      {sourcePage ? (
        <EpisodeSourcesScreen
          meta={display}
          video={activeVideo}
          onBack={() => {
            onCancelResume?.();
            setVideoId(null);
          }}
        >
          {sourceSection}
        </EpisodeSourcesScreen>
      ) : null}
      {currentExternal ? (
        <ExternalSourceDialog url={currentExternal.url} onClose={() => setExternalChoice(null)} />
      ) : null}
      {checkingResume ? <ResumeCover onCancel={() => onCancelResume?.()} /> : null}
    </div>
  );
}
