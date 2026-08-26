import type { CoreStream } from '../core/types';

export interface TorrentRequest {
  body: { announce: string[]; guessFileIdx: boolean };
  createUrl: string;
}

export interface TorrentStats {
  guessedFileIdx?: number;
  hasMetadata?: boolean;
  name?: string;
}

// The engine speaks Stremio's streaming-server API: create the engine for an
// infoHash, then read the chosen file over HTTP ranges (ADR 0015).
export function torrentCreateRequest(engineUrl: string, stream: CoreStream): TorrentRequest {
  const infoHash = String(stream.infoHash).toLowerCase();
  const announce = (stream.sources ?? []).filter((source) => source.startsWith('tracker:'));
  return {
    body: {
      announce: announce.map((source) => source.slice('tracker:'.length)),
      guessFileIdx: stream.fileIdx === undefined || stream.fileIdx === null,
    },
    createUrl: `${engineUrl.replace(/\/$/, '')}/${infoHash}/create`,
  };
}

export function torrentMediaUrl(engineUrl: string, stream: CoreStream, fileIdx: number) {
  const infoHash = String(stream.infoHash).toLowerCase();
  return `${engineUrl.replace(/\/$/, '')}/${infoHash}/${fileIdx}`;
}

export function resolveFileIndex(stream: CoreStream, stats: TorrentStats): number | null {
  if (typeof stream.fileIdx === 'number' && stream.fileIdx >= 0) return stream.fileIdx;
  if (typeof stats.guessedFileIdx === 'number' && stats.guessedFileIdx >= 0) {
    return stats.guessedFileIdx;
  }
  return null;
}
