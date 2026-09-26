import { buildMediaQuery, parseMediaResponse, type NormalizedSegmentTimestamp } from 'theintrodb';

export interface Chapter {
  endMs: number;
  startMs: number;
  title: string;
}

export type ChapterCue = Omit<Chapter, 'endMs'>;

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

export function markerFromChapterCues(
  chapters: ChapterCue[],
  durationMs: number,
): IntroMarker | null {
  const ordered = chapters
    .filter((chapter) => Number.isFinite(chapter.startMs) && chapter.startMs >= 0)
    .toSorted((left, right) => left.startMs - right.startMs);
  return markerFromChapters(
    ordered.map((chapter, index) => ({
      ...chapter,
      endMs: ordered[index + 1]?.startMs ?? durationMs,
    })),
    durationMs,
  );
}

export function markerFromCommunity(
  candidates: NormalizedSegmentTimestamp[],
  durationMs: number,
): IntroMarker | null {
  // Runtime selection is checked before these normalized segment bounds.
  const candidate = candidates.find(
    (segment) => segment.endMs !== null && validBounds(segment.startMs, segment.endMs, durationMs),
  );
  return candidate?.endMs == null
    ? null
    : { source: 'theintrodb', startMs: candidate.startMs, endMs: candidate.endMs };
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_VERSIONS = 512;
// TheIntroDB selects a version up to 60 s from its runtime and falls back at
// 61 s, measured against the live service on 2026-09-26; its documentation
// gives no number.
export const VERSION_WINDOW_MS = 60_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readMedia(query: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`https://api.theintrodb.org/v3/media?${query}`, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Intro lookup unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error('Intro response too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function lookupCommunityIntro(
  identity: IntroIdentity,
  signal?: AbortSignal,
): Promise<IntroMarker | null> {
  if (!identity.tmdbId && !identity.imdbId) return null;
  if (!Number.isSafeInteger(identity.durationMs) || identity.durationMs <= 0) return null;
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]);
  try {
    const query = buildMediaQuery(identity);
    query.set('list_versions', 'true');
    const versions = await readMedia(query, requestSignal);
    if (!record(versions) || !Array.isArray(versions.versions)) return null;
    const matchesIdentity = (media: ReturnType<typeof parseMediaResponse>) =>
      media.type === (identity.season === undefined ? 'movie' : 'tv') &&
      media.season === identity.season &&
      media.episode === identity.episode &&
      (identity.tmdbId === undefined || media.tmdbId === identity.tmdbId);
    const listed = parseMediaResponse(versions);
    if (!matchesIdentity(listed) || versions.versions.length > MAX_VERSIONS) return null;
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const listedVersions = (versions.versions as unknown[]).map((version) => {
      if (!record(version)) return null;
      const runtime = count(version.duration_ms);
      const average =
        version.average_duration_ms === undefined ? runtime : count(version.average_duration_ms);
      return runtime === null || average === null ? null : { runtime, average };
    });
    if (listedVersions.some((version) => version === null)) return null;
    // The service groups submissions into release versions and treats a
    // runtime within a minute of one as that version, otherwise falling back to
    // the most submitted. Exactly one version, by both its listed and its
    // average runtime, lets Kino reject that fallback before reading markers.
    // The zero-runtime version is unknown and never qualifies.
    const near = (runtime: number) => Math.abs(runtime - identity.durationMs) <= VERSION_WINDOW_MS;
    const matching = listedVersions.filter(
      (version) =>
        version !== null && version.runtime > 0 && near(version.runtime) && near(version.average),
    );
    if (matching.length !== 1) return null;
    query.delete('list_versions');
    query.set('merge_unknown', 'false');
    const media = parseMediaResponse(await readMedia(query, requestSignal));
    if (!matchesIdentity(media) || media.tmdbId !== listed.tmdbId) return null;
    requestSignal.throwIfAborted();
    return markerFromCommunity(media.intro, identity.durationMs);
  } catch {
    if (signal?.aborted) throw new DOMException('Intro lookup canceled', 'AbortError');
    return null;
  }
}
