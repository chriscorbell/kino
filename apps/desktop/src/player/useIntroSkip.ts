import { useEffect, useMemo, useState } from 'react';

import type { PlaybackSelection } from '../core/actions';
import {
  introFromChapters,
  lookupCommunityIntro,
  type ChapterCue,
  type IntroMarker,
} from '../intro/markers';

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
  chapterCues,
  duration,
  hasPlayer,
  seek,
  selection,
  time,
}: {
  automatic: boolean;
  chapterCues: ChapterCue[];
  duration: number;
  hasPlayer: boolean;
  /** Reports the seek to Core as well. */
  seek: (milliseconds: number) => void;
  selection: PlaybackSelection;
  time: number;
}) {
  const [communityLookup, setCommunityLookup] = useState<{
    selection: PlaybackSelection;
    duration: number;
    marker: IntroMarker | null;
  } | null>(null);
  // Where the automatic skip went. It happens at most once, so the intro plays after Undo.
  const [automaticSkip, setAutomaticSkip] = useState<number | null>(null);
  const [automaticNotice, setAutomaticNotice] = useState(false);
  const chapterIntro = useMemo(
    () => introFromChapters(chapterCues, duration),
    [chapterCues, duration],
  );
  const communityMarker =
    communityLookup?.selection === selection && communityLookup.duration === duration
      ? communityLookup.marker
      : null;
  const marker =
    chapterIntro === 'absent' ? communityMarker : chapterIntro === 'unknown' ? null : chapterIntro;

  useEffect(() => {
    if (!duration || chapterIntro !== 'absent') return;

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
  }, [chapterIntro, duration, selection]);

  const insideIntro = Boolean(marker && time >= marker.startMs && time < marker.endMs);
  if (marker && insideIntro && automatic && hasPlayer && automaticSkip === null) {
    setAutomaticSkip(marker.endMs);
    setAutomaticNotice(true);
  }
  useEffect(() => {
    if (automaticSkip !== null) seek(automaticSkip);
  }, [automaticSkip, seek]);

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
    automaticSkipComplete: automaticSkip !== null,
    insideIntro,
    marker,
    markerStyle,
    skip() {
      if (marker) seek(marker.endMs);
    },
    undoAutomaticSkip() {
      if (!marker) return;
      seek(marker.startMs);
      setAutomaticNotice(false);
    },
  };
}
