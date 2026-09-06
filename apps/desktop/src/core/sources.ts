import type { PlaybackSelection } from './actions';
import type { CoreSource, CoreStreamSource } from './types';

export type SourceSupport = 'direct' | 'external' | 'torrent' | 'unsupported';

export function classifySource(source: CoreStreamSource): SourceSupport {
  switch (source.kind) {
    case 'torrent':
      return 'torrent';
    case 'url':
      return source.url.startsWith('https://') ? 'direct' : 'unsupported';
    case 'external':
      return 'external';
    case 'playerFrame':
    case 'youtube':
      return 'unsupported';
  }
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

export function unsupportedSourceReason(source: CoreStreamSource) {
  switch (source.kind) {
    case 'external':
      return 'external';
    case 'youtube':
      return 'youtube';
    case 'playerFrame':
      return 'embedded';
    case 'url':
      return source.url.startsWith('http://') ? 'insecure' : 'protocol';
    case 'torrent':
      return 'unknown';
  }
}

function sourceIdentity(source: CoreStreamSource, requestHeaders: Array<[string, string]>) {
  switch (source.kind) {
    case 'torrent':
      // Explicit files in a pack and guesses for different episodes are
      // separate attempts, and different peer sources are different attempts
      // at the same swarm.
      return [
        'torrent',
        source.infoHash.toLowerCase(),
        source.fileIdx,
        [...new Set(source.sources)].sort(),
      ];
    case 'url':
      return ['direct', source.url, requestHeaders];
    case 'external':
      return ['external', source.externalUrl];
    case 'playerFrame':
      return ['embedded', source.playerFrameUrl];
    case 'youtube':
      return ['youtube', source.ytId];
  }
}

export function sourceKey(
  source: CoreSource,
  transportUrl: string,
  selection: Pick<PlaybackSelection, 'meta' | 'video'>,
) {
  const requestHeaders = Object.entries(source.hints.proxyRequestHeaders ?? {})
    .map(([name, value]): [string, string] => [name.toLowerCase(), value])
    .sort(([left], [right]) => left.localeCompare(right));
  // Display metadata and progress do not change the source identity.
  return JSON.stringify([
    transportUrl,
    selection.meta.type,
    selection.meta.id,
    selection.video?.id ?? selection.meta.id,
    sourceIdentity(source.source, requestHeaders),
  ]);
}
