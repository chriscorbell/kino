import { useEffect, useMemo, useState } from 'react';

import { t as enUS } from '../locales';
import type { NativePlayer } from '../native/player';
import {
  resolveFileIndex,
  torrentCreateRequest,
  torrentMediaUrl,
  type TorrentSource,
  type TorrentStats,
} from './torrent';

type ReportFailure = (message: string, diagnostic?: Record<string, unknown>) => void;

/**
 * Starts the bundled streaming engine for a torrent source, asks it to open the
 * torrent, and yields the engine's media URL for the chosen file.
 */
export function useTorrentStream(
  resolvedTorrent: TorrentSource | null,
  nativePlayer: NativePlayer | null,
  reportFailure: ReportFailure,
) {
  // Every Player snapshot rebuilds the adapted stream, so a progress or subtitle
  // update would hand the effects below a new object for the same torrent and
  // restart the streaming engine mid-transfer. Hold it steady by its own value.
  // The adapter already checked these fields and keeps each peer hint verbatim,
  // so the key has to be lossless: a hint may contain any characters, and
  // splitting one apart would invent a tracker the add-on never offered.
  const torrentKey = resolvedTorrent === null ? null : JSON.stringify(resolvedTorrent);
  const torrent = useMemo<TorrentSource | null>(
    () => (torrentKey === null ? null : (JSON.parse(torrentKey) as TorrentSource)),
    [torrentKey],
  );
  const [torrentUrl, setTorrentUrl] = useState<string | null>(null);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!torrent || !nativePlayer) return;
    const onEngine = (url: string, error: string) => {
      if (error) {
        reportFailure(error);
      } else if (url) {
        setEngineUrl(url);
      }
    };
    nativePlayer.streamingEngineChanged.connect(onEngine);
    nativePlayer.startStreamingEngine();
    return () => nativePlayer.streamingEngineChanged.disconnect(onEngine);
  }, [nativePlayer, reportFailure, torrent]);

  useEffect(() => {
    if (!torrent || !engineUrl || torrentUrl) return;
    const controller = new AbortController();
    const request = torrentCreateRequest(engineUrl, torrent);

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
        setTorrentUrl(torrentMediaUrl(engineUrl, torrent, fileIndex));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        reportFailure(enUS.player.torrentFailed, {
          code: error instanceof Error ? error.message : 'UnknownError',
        });
      });
    return () => controller.abort();
  }, [engineUrl, reportFailure, torrent, torrentUrl]);

  return { torrent, torrentUrl };
}
