import type { CoreStream } from './types';

export type SourceSupport = 'direct' | 'external' | 'torrent' | 'unsupported';

export function classifySource(stream: CoreStream): SourceSupport {
  if (stream.url?.startsWith('https://')) return 'direct';
  if (stream.infoHash) return 'torrent';
  if (stream.externalUrl) return 'external';
  return 'unsupported';
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
