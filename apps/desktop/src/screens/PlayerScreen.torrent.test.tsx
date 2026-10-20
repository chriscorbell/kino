import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { CoreSource, PlayerState } from '../core/types';
import { preview, torrentSource } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback } from '../test/playback';

const native = fakeNativePlayer();

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Mount the player on a torrent whose Player snapshots are rebuilt on every
 * read, exactly as the worker does after a progress or subtitle update.
 */
async function mountTorrentPlayer(stream: CoreSource) {
  let title = 'Fixture';
  const snapshot = (): PlayerState => ({
    libraryItem: { id: 'fixture', timeOffset: 0, videoId: null },
    selected: { stream: structuredClone(stream) },
    stream: { type: 'Ready', content: { source: structuredClone(stream.source) } },
    subtitles: [],
    title,
  });
  const { publish } = await mountPlayback({
    selection: {
      meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      stream,
      streamTransportUrl: 'https://addon.invalid/manifest.json',
      video: null,
      nextVideo: null,
    },
    native,
    player: snapshot,
  });

  return {
    async publishSnapshot(nextTitle: string) {
      title = nextTitle;
      await publish();
    },
    reportEngine: (url: string) => native.streamingEngineChanged.emit(url, ''),
  };
}

it('starts the streaming engine once across repeated Player snapshots', async () => {
  // Reconstructing the torrent must not tear the engine down and start it again
  // underneath a running transfer.
  const player = await mountTorrentPlayer(
    torrentSource({ fileIdx: 0, sources: ['tracker:https://tracker.invalid/announce'] }),
  );

  await waitFor(() => expect(native.startStreamingEngine).toHaveBeenCalledOnce());
  expect(await screen.findByText('Finding peers for this torrent…')).toBeInTheDocument();

  await player.publishSnapshot('Fixture — 30s');
  await player.publishSnapshot('Fixture — 60s');

  expect(native.startStreamingEngine).toHaveBeenCalledOnce();
  expect(native.streamingEngineChanged.disconnect).not.toHaveBeenCalled();
});

it('hands the engine the add-on peer hints exactly as the adapter kept them', async () => {
  // A peer hint is an opaque add-on string. Rebuilding the source from a lossy
  // key could split one entry into two and turn a dht hint into a tracker the
  // add-on never offered, so the array has to survive character for character.
  const sources = [
    'dht:synthetic\ntracker:https://injected.invalid/announce',
    '',
    'tracker:udp://real.invalid:1337/announce',
  ];
  const created: Array<{ peerSearch: { sources: string[] }; guessFileIdx: boolean }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      created.push(JSON.parse(init.body));
      return Response.json({ guessedFileIdx: 0 });
    }),
  );

  const player = await mountTorrentPlayer(torrentSource({ fileIdx: 0, sources }));
  await waitFor(() => expect(native.startStreamingEngine).toHaveBeenCalledOnce());
  await player.reportEngine('http://127.0.0.1:11470/kino/test');
  await waitFor(() => expect(created).toHaveLength(1));

  // Only the real tracker reaches the swarm. The dht hint stays one entry and
  // is filtered, and the empty entry contributes nothing.
  expect(created[0]?.peerSearch.sources).toEqual(['udp://real.invalid:1337/announce']);
  expect(JSON.stringify(created[0])).not.toContain('injected.invalid');
  expect(created[0]?.guessFileIdx).toBe(false);

  // Later snapshots must not re-create the engine for the same torrent either.
  await player.publishSnapshot('Fixture — 30s');
  expect(created).toHaveLength(1);
  expect(native.startStreamingEngine).toHaveBeenCalledOnce();
});
