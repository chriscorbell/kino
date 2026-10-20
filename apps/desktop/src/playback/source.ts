// Turns the viewer's chosen source into the URL the backend opens. The session
// asks once, so a new Player snapshot cannot restart the streaming engine
// underneath a running transfer.

import type { PlaybackSelection } from '../core/actions';
import type { CoreResolvedStream } from '../core/types';
import { t as enUS } from '../locales/index.ts';
import type { NativePlayer } from '../native/player';
import {
  resolveFileIndex,
  torrentCreateRequest,
  torrentMediaUrl,
  type TorrentSource,
  type TorrentStats,
} from '../player/torrent.ts';

export interface ResolvedSource {
  url: string;
  headers: Readonly<Record<string, string>>;
}

export type ReportFailure = (message: string, diagnostic?: Record<string, unknown>) => void;

/**
 * The URL to open for a source Core resolved without the engine, or null when
 * Kino cannot play its kind. Core wraps direct streams with proxy headers in a
 * URL for the account's Stremio Service. The native backend sends those
 * headers itself, using the original source URL independently of that
 * service's address.
 */
export function directSource(
  selection: PlaybackSelection,
  resolved: CoreResolvedStream,
): ResolvedSource | null {
  const chosen = selection.stream.source;
  if (chosen.kind === 'url' && chosen.url.startsWith('https://')) {
    return { url: chosen.url, headers: selection.stream.hints.proxyRequestHeaders ?? {} };
  }
  return resolved.source.kind === 'url' ? { url: resolved.source.url, headers: {} } : null;
}

/**
 * Starts the bundled streaming engine, asks it to open the torrent, and hands
 * over the engine's media URL for the chosen file. Returns the cleanup. An
 * engine error stays a failure for as long as the listener is connected.
 */
export function streamTorrent(
  torrent: TorrentSource,
  engine: Pick<NativePlayer, 'startStreamingEngine' | 'streamingEngineChanged'>,
  {
    fetch,
    onUrl,
    fail,
  }: { fetch: typeof globalThis.fetch; onUrl(url: string): void; fail: ReportFailure },
): () => void {
  let engineUrl: string | null = null;
  let found = false;
  let creating: AbortController | null = null;

  const create = (base: string) => {
    creating?.abort();
    const controller = new AbortController();
    creating = controller;
    const request = torrentCreateRequest(base, torrent);
    void fetch(request.createUrl, {
      body: JSON.stringify(request.body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Engine returned ${response.status}.`);
        const stats = (await response.json()) as TorrentStats;
        const fileIndex = resolveFileIndex(torrent, stats);
        if (fileIndex === null) {
          throw new Error('The engine could not identify a playable file.');
        }
        found = true;
        onUrl(torrentMediaUrl(base, torrent, fileIndex));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        fail(enUS.player.torrentFailed, {
          code: error instanceof Error ? error.message : 'UnknownError',
        });
      });
  };

  const onEngine = (url: string, error: string) => {
    if (error) {
      fail(error);
    } else if (url && url !== engineUrl && !found) {
      engineUrl = url;
      create(url);
    }
  };
  engine.streamingEngineChanged.connect(onEngine);
  engine.startStreamingEngine();
  return () => {
    engine.streamingEngineChanged.disconnect(onEngine);
    creating?.abort();
  };
}
