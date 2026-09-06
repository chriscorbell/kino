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
    const runtimes = versions.versions.map((version: unknown) =>
      record(version) ? version.duration_ms : undefined,
    );
    if (
      runtimes.some(
        (runtime) => typeof runtime !== 'number' || !Number.isSafeInteger(runtime) || runtime < 0,
      )
    )
      return null;
    // The service deliberately falls back to another release when no runtime
    // matches. Its version list lets Kino reject that fallback before reading
    // markers. The zero-runtime bucket is unknown and never qualifies.
    if (runtimes.filter((runtime) => runtime === identity.durationMs).length !== 1) return null;
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
