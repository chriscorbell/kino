import type { CorePlayerStream } from '../core/types';

export interface TorrentRequest {
  body: { peerSearch: { sources: string[] }; guessFileIdx: boolean };
  createUrl: string;
}

export interface TorrentStats {
  guessedFileIdx?: number;
  hasMetadata?: boolean;
  name?: string;
}

// The engine speaks Stremio's streaming-server API: create the engine for an
// infoHash, then read the chosen file over HTTP ranges (ADR 0015).
export function torrentCreateRequest(engineUrl: string, stream: CorePlayerStream): TorrentRequest {
  const infoHash = String(stream.infoHash).toLowerCase();
  const trackers = (stream.announce ?? [])
    .map((source) => (source.startsWith('tracker:') ? source.slice('tracker:'.length) : source))
    .filter((source) => /^(https?|udp):\/\//.test(source));
  return {
    body: {
      peerSearch: { sources: [...new Set(trackers)] },
      guessFileIdx: stream.fileIdx === undefined || stream.fileIdx === null,
    },
    createUrl: `${engineUrl.replace(/\/$/, '')}/${infoHash}/create`,
  };
}

export function torrentMediaUrl(engineUrl: string, stream: CorePlayerStream, fileIdx: number) {
  const infoHash = String(stream.infoHash).toLowerCase();
  return `${engineUrl.replace(/\/$/, '')}/${infoHash}/${fileIdx}`;
}

export function resolveFileIndex(stream: CorePlayerStream, stats: TorrentStats): number | null {
  if (typeof stream.fileIdx === 'number' && stream.fileIdx >= 0) return stream.fileIdx;
  if (typeof stats.guessedFileIdx === 'number' && stats.guessedFileIdx >= 0) {
    return stats.guessedFileIdx;
  }
  return null;
}
