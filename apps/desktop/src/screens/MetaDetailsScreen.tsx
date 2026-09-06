import { ArrowLeft, CaretRight, Check, Play, Plus } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from '../App.module.css';
import { SourcePickerDialog } from '../components/SourcePickerDialog';
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
import {
  classifySource,
  externalWebUrl,
  sourceDetails,
  sourceKey,
  sourceSize,
  sourceTitle,
  unsupportedSourceReason,
} from '../core/sources';
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
}: {
  failedSources: ReadonlyMap<string, string>;
  initialVideoId?: string | null;
  item: CoreMetaPreview;
  onBack: () => void;
  onPlay: (selection: PlaybackSelection) => void;
  resumeRequest?: ResumeRequest | null;
  onCancelResume?: () => void;
}) {
  const { transport } = useCore();
  const libraryAction = useActionFeedback(transport);
  const [videoId, setVideoId] = useState<string | null>(
    () => initialVideoId ?? item.defaultVideoId,
  );
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
  } else if (loadedMeta && loadedMeta !== lastMeta) setLastMeta(loadedMeta);
  const meta = loadedMeta ?? (profileTransport === transport ? lastMeta : null);
  const videos = useMemo(() => meta?.videos ?? [], [meta]);
  const selectedEpisodeRef = useRef<HTMLButtonElement>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(
    () => item.type === 'series' && Boolean(initialVideoId),
  );

  useEffect(() => {
    if (item.type !== 'series' || videoId !== null || videos.length === 0) return;
    const firstEpisode = videos.find((video) => (video.season ?? 0) > 0) ?? videos[0];
    if (!firstEpisode) return;
    const timeout = window.setTimeout(() => setVideoId(firstEpisode.id), 0);
    return () => window.clearTimeout(timeout);
  }, [item.type, videoId, videos]);

  // A video Core did not place in a season gets no tab. Its season stays null so
  // the episode list below still shows it under the same null selection.
  const seasons = useMemo(
    () => [...new Set(videos.flatMap((video) => (video.season === null ? [] : [video.season])))],
    [videos],
  );
  const activeVideo =
    videos.find((video) => video.id === videoId) ??
    videos.find((video) => (video.season ?? 0) > 0) ??
    videos[0] ??
    null;
  const activeSeason = activeVideo?.season ?? seasons[0] ?? null;
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
      {checkingResume ? (
        <p className={styles.inlineEmpty} role="status">
          {enUS.details.checkingResume}
        </p>
      ) : null}
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
          const size = sourceSize(choice.source);
          return (
            <div className={styles.sourceRow} key={`${choice.transportUrl}:${index}`}>
              <button
                className={styles.sourceButton}
                disabled={checkingResume || !selectable || !sourcesCurrent || !choice.current}
                onClick={() => {
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
                type="button"
              >
                <span className={styles.sourcePrimary}>
                  <strong>{sourceTitle(choice.source)}</strong>
                  <small>{sourceDetails(choice.source)}</small>
                  {external ? (
                    <small className={styles.sourceExplanation}>
                      {enUS.details.openExternal} · {external.host}
                    </small>
                  ) : null}
                  {!selectable ? (
                    <small className={styles.sourceExplanation}>{unavailable}</small>
                  ) : null}
                </span>
                <span className={styles.sourceMeta}>
                  {playable ? (
                    <span className={styles.sourcePlay}>
                      <Play aria-hidden size={14} weight="fill" />
                      {enUS.details.playSource}
                    </span>
                  ) : null}
                  {size ? <span>{size}</span> : null}
                  <span>{choice.addonName}</span>
                  {!selectable ? <em>{enUS.details.unavailable}</em> : null}
                  {playable && failed ? <em>{enUS.details.failed}</em> : null}
                </span>
              </button>
              <details className={styles.sourceDisclosure} key={key}>
                <summary>
                  {enUS.details.inspectSource}
                  <span className={styles.visuallyHidden}> {sourceTitle(choice.source)}</span>
                </summary>
                <div className={styles.sourceDescription}>
                  <p>{choice.source.description?.trim() || sourceDetails(choice.source)}</p>
                  {choice.source.hints.filename ? (
                    <dl>
                      <dt>{enUS.details.filename}</dt>
                      <dd>{choice.source.hints.filename}</dd>
                    </dl>
                  ) : null}
                  {!selectable ? <p>{unavailable}</p> : null}
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );

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
        {item.type === 'series' && !sourcePickerOpen ? (
          <ResourceFailures
            names={failures}
            error={result.error ? enUS.details.error : null}
            pending={sourcesPending}
            onRetry={result.retry}
          />
        ) : null}
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
                      if (first) chooseVideo(first.id);
                    }}
                    type="button"
                  >
                    {enUS.details.season(season)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.episodeList}>
              {visibleVideos.map((video: CoreVideo) => (
                <div
                  className={`${styles.episodeRow} ${video.id === videoId ? styles.episodeActive : ''}`}
                  key={video.id}
                >
                  <button
                    aria-current={video.id === videoId ? 'true' : undefined}
                    ref={video.id === videoId ? selectedEpisodeRef : undefined}
                    aria-haspopup="dialog"
                    className={styles.episodeButton}
                    onClick={() => {
                      chooseVideo(video.id);
                      setSourcePickerOpen(true);
                    }}
                    type="button"
                  >
                    <span className={styles.episodeNumber}>
                      {String(video.episode ?? 0).padStart(2, '0')}
                    </span>
                    <strong>{video.title || enUS.details.episode(video.episode)}</strong>
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
      {item.type === 'series' && sourcePickerOpen ? (
        <SourcePickerDialog
          returnFocus={selectedEpisodeRef}
          title={activeVideo?.title || display.name}
          onClose={() => {
            onCancelResume?.();
            setSourcePickerOpen(false);
          }}
        >
          {sourceSection}
        </SourcePickerDialog>
      ) : null}
      {currentExternal ? (
        <ExternalSourceDialog url={currentExternal.url} onClose={() => setExternalChoice(null)} />
      ) : null}
    </div>
  );
}
