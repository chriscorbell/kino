import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { PlaybackSelection } from '../core/actions';
import {
  lookupCommunityIntro,
  markerFromChapterCues,
  type ChapterCue,
  type IntroMarker,
} from '../intro/markers';
import type { NativePlayer } from '../native/player';

function introIdentity(selection: PlaybackSelection, durationMs: number) {
  const imdbId = /^tt\d+$/.test(selection.meta.id) ? selection.meta.id : null;
  const { episode = null, season = null } = selection.video ?? {};
  return {
    durationMs,
    ...(episode === null ? {} : { episode }),
    ...(imdbId === null ? {} : { imdbId }),
    ...(season === null ? {} : { season }),
  };
}

/**
 * Finds the intro from the file's chapters, or failing that from a trusted
 * community marker, and performs the optional automatic skip with its Undo.
 */
export function useIntroSkip({
  automatic,
  duration,
  nativePlayer,
  reportProgress,
  seekTo,
  selection,
  time,
  videoRef,
}: {
  automatic: boolean;
  duration: number;
  nativePlayer: NativePlayer | null;
  reportProgress: (isSeek?: boolean) => void;
  seekTo: (milliseconds: number) => void;
  selection: PlaybackSelection;
  time: number;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [chapterCues, setChapterCues] = useState<ChapterCue[]>([]);
  const [communityLookup, setCommunityLookup] = useState<{
    selection: PlaybackSelection;
    duration: number;
    marker: IntroMarker | null;
  } | null>(null);
  const [automaticSkipComplete, setAutomaticSkipComplete] = useState(false);
  const [automaticNotice, setAutomaticNotice] = useState(false);
  const autoSkipSuppressedRef = useRef(false);
  const chapterMarker = useMemo(
    () => markerFromChapterCues(chapterCues, duration),
    [chapterCues, duration],
  );
  const communityMarker =
    communityLookup?.selection === selection && communityLookup.duration === duration
      ? communityLookup.marker
      : null;
  const marker = chapterMarker ?? communityMarker;

  useEffect(() => {
    if (!duration || chapterMarker) return;

    const controller = new AbortController();
    void lookupCommunityIntro(introIdentity(selection, duration), controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setCommunityLookup({ selection, duration, marker: found });
        console.info(
          found
            ? '[kino:intro] trusted community marker'
            : '[kino:intro] no trusted community marker',
          found ?? '',
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.info(
          '[kino:intro] community lookup failed',
          error instanceof Error ? error.message : error,
        );
      });
    return () => controller.abort();
  }, [chapterMarker, duration, selection]);

  useEffect(() => {
    if (!marker || !automatic || automaticSkipComplete || autoSkipSuppressedRef.current) return;
    if (time < marker.startMs || time >= marker.endMs) return;
    if (!nativePlayer && !videoRef.current) return;
    seekTo(marker.endMs);
    setAutomaticSkipComplete(true);
    setAutomaticNotice(true);
    reportProgress(true);
  }, [
    automatic,
    automaticSkipComplete,
    marker,
    nativePlayer,
    reportProgress,
    seekTo,
    time,
    videoRef,
  ]);

  useEffect(() => {
    if (!automaticNotice) return;
    const timeout = window.setTimeout(() => setAutomaticNotice(false), 8_000);
    return () => window.clearTimeout(timeout);
  }, [automaticNotice]);

  const markerStyle = useMemo(() => {
    if (!marker || duration <= 0) return undefined;
    return {
      left: `${(marker.startMs / duration) * 100}%`,
      width: `${((marker.endMs - marker.startMs) / duration) * 100}%`,
    };
  }, [duration, marker]);

  return {
    automaticNotice,
    automaticSkipComplete,
    insideIntro: Boolean(marker && time >= marker.startMs && time < marker.endMs),
    marker,
    markerStyle,
    setChapterCues,
    skip() {
      if (!marker) return;
      seekTo(marker.endMs);
      reportProgress(true);
    },
    undoAutomaticSkip() {
      if (!marker) return;
      autoSkipSuppressedRef.current = true;
      seekTo(marker.startMs);
      setAutomaticNotice(false);
      reportProgress(true);
    },
  };
}
