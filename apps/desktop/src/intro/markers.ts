import { createIntroDbClient, type NormalizedSegmentTimestamp } from 'theintrodb';

export interface Chapter {
  endMs: number;
  startMs: number;
  title: string;
}

export interface IntroIdentity {
  durationMs: number;
  episode?: number;
  imdbId?: string;
  season?: number;
  tmdbId?: number;
}

export interface IntroMarker {
  endMs: number;
  source: 'chapter' | 'theintrodb';
  startMs: number;
}

const introDb = createIntroDbClient();
const INTRO_LABEL = /^(intro|introduction|opening|opening credits|op)$/i;

function validBounds(startMs: number, endMs: number, durationMs: number) {
  const segmentDuration = endMs - startMs;
  return (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs >= 0 &&
    endMs <= durationMs &&
    segmentDuration >= 5_000 &&
    segmentDuration <= 200_000
  );
}

export function markerFromChapters(chapters: Chapter[], durationMs: number): IntroMarker | null {
  const chapter = chapters.find(
    (candidate) =>
      INTRO_LABEL.test(candidate.title.trim()) &&
      validBounds(candidate.startMs, candidate.endMs, durationMs),
  );
  return chapter ? { source: 'chapter', startMs: chapter.startMs, endMs: chapter.endMs } : null;
}

export function markerFromCommunity(
  candidates: NormalizedSegmentTimestamp[],
  durationMs: number,
): IntroMarker | null {
  const candidate = candidates.find(
    (segment) =>
      segment.endMs !== null &&
      (segment.confidence ?? 0) >= 0.8 &&
      (segment.submissionCount ?? 0) >= 2 &&
      validBounds(segment.startMs, segment.endMs, durationMs),
  );
  return candidate?.endMs == null
    ? null
    : { source: 'theintrodb', startMs: candidate.startMs, endMs: candidate.endMs };
}

export async function lookupCommunityIntro(
  identity: IntroIdentity,
  signal?: AbortSignal,
): Promise<IntroMarker | null> {
  if (!identity.tmdbId && !identity.imdbId) return null;
  const media = await introDb.getMedia(
    {
      durationMs: identity.durationMs,
      ...(identity.episode === undefined ? {} : { episode: identity.episode }),
      ...(identity.imdbId === undefined ? {} : { imdbId: identity.imdbId }),
      ...(identity.season === undefined ? {} : { season: identity.season }),
      ...(identity.tmdbId === undefined ? {} : { tmdbId: identity.tmdbId }),
    },
    { signal },
  );
  return markerFromCommunity(media.intro, identity.durationMs);
}
