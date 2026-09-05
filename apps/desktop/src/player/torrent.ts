import type { CoreStreamSource } from '../core/types';

export type TorrentSource = Extract<CoreStreamSource, { kind: 'torrent' }>;

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
export function torrentCreateRequest(engineUrl: string, source: TorrentSource): TorrentRequest {
  const infoHash = source.infoHash.toLowerCase();
  const trackers = source.sources
    .map((entry) => (entry.startsWith('tracker:') ? entry.slice('tracker:'.length) : entry))
    .filter((entry) => /^(https?|udp):\/\//.test(entry));
  return {
    body: {
      peerSearch: { sources: [...new Set(trackers)] },
      guessFileIdx: source.fileIdx === null,
    },
    createUrl: `${engineUrl.replace(/\/$/, '')}/${infoHash}/create`,
  };
}

export function torrentMediaUrl(engineUrl: string, source: TorrentSource, fileIdx: number) {
  return `${engineUrl.replace(/\/$/, '')}/${source.infoHash.toLowerCase()}/${fileIdx}`;
}

export function resolveFileIndex(source: TorrentSource, stats: TorrentStats): number | null {
  if (source.fileIdx !== null && source.fileIdx >= 0) return source.fileIdx;
  if (typeof stats.guessedFileIdx === 'number' && stats.guessedFileIdx >= 0) {
    return stats.guessedFileIdx;
  }
  return null;
}
