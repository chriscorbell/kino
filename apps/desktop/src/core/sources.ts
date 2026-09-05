import type { PlaybackSelection } from './actions';
import type { CoreStream } from './types';

export type SourceSupport = 'direct' | 'external' | 'torrent' | 'unsupported';

export function classifySource(stream: CoreStream): SourceSupport {
  if (stream.url?.startsWith('https://')) return 'direct';
  if (stream.infoHash) return 'torrent';
  if (stream.externalUrl) return 'external';
  return 'unsupported';
}

// Require an explicit web scheme and reject spellings that URL would silently
// repair before showing the destination in the confirmation.
export function externalWebUrl(value: string | null | undefined): URL | null {
  if (!value || !/^https?:\/\//i.test(value) || /[\s\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.host && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function unsupportedSourceReason(stream: CoreStream) {
  if (stream.externalUrl) return 'external';
  if (stream.ytId) return 'youtube';
  if (stream.playerFrameUrl) return 'embedded';
  if (stream.url?.startsWith('http://')) return 'insecure';
  if (stream.url) return 'protocol';
  return 'unknown';
}

export function sourceKey(
  stream: CoreStream,
  transportUrl: string,
  selection: Pick<PlaybackSelection, 'meta' | 'video'>,
) {
  const requestHeaders = Object.entries(stream.behaviorHints?.proxyHeaders?.request ?? {})
    .map(([name, value]): [string, string] => [name.toLowerCase(), value])
    .sort(([left], [right]) => left.localeCompare(right));
  const identity = stream.url
    ? ['direct', stream.url, requestHeaders]
    : stream.infoHash
      ? [
          'torrent',
          stream.infoHash.toLowerCase(),
          stream.fileIdx ?? null,
          [...new Set(stream.sources ?? [])].sort(),
        ]
      : stream.externalUrl
        ? ['external', stream.externalUrl]
        : ['unsupported', stream.ytId ?? null, stream.playerFrameUrl ?? null];
  // Explicit files in a pack and guesses for different episodes are separate
  // attempts. Display metadata and progress do not change the source identity.
  return JSON.stringify([
    transportUrl,
    selection.meta.type,
    selection.meta.id,
    selection.video?.id ?? selection.meta.id,
    identity,
  ]);
}

export function sourceTitle(stream: CoreStream) {
  return stream.name?.trim() || stream.description?.split('\n')[0]?.trim() || 'Unnamed source';
}

export function sourceDetails(stream: CoreStream) {
  const detail = stream.description?.trim();
  if (detail && detail !== sourceTitle(stream)) return detail;

  const filename = stream.behaviorHints?.filename?.trim();
  if (filename) return filename;

  switch (classifySource(stream)) {
    case 'direct':
      return 'HTTPS direct stream';
    case 'torrent':
      return 'Torrent source';
    case 'external':
      return 'External destination';
    case 'unsupported':
      return 'Unsupported source type';
  }
}

export function sourceSize(stream: CoreStream) {
  const bytes = stream.behaviorHints?.videoSize;
  if (!bytes || bytes <= 0) return null;
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes < 1 ? gibibytes.toFixed(2) : gibibytes.toFixed(1)} GB`;
}
