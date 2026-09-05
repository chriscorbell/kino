import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreRuntimeEvent, PlayerState } from '../core/types';
import { defaultSettings } from '../settings';
import { preview, torrentSource } from '../test/coreState';
import { PlayerScreen } from './PlayerScreen';

const native = vi.hoisted(() => ({
  load: vi.fn(),
  stop: vi.fn(),
  startStreamingEngine: vi.fn(),
  streamingEngineChanged: { connect: vi.fn(), disconnect: vi.fn() },
  fullscreen: false,
  fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
  playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
  setVolume: vi.fn(),
  setSubtitleScale: vi.fn(),
  setSubtitlePosition: vi.fn(),
  setNowPlayingMetadata: vi.fn(),
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  connectNativePlayer: async () => native,
}));

const stream = torrentSource(
  { fileIdx: 0, sources: ['tracker:https://tracker.invalid/announce'] },
  { name: 'Pack file' },
);

it('starts the streaming engine once across repeated Player snapshots', async () => {
  // Each read returns a freshly adapted state, exactly as the worker does after
  // a progress or subtitle update. Reconstructing the torrent must not tear the
  // engine down and start it again underneath a running transfer.
  let title = 'Fixture';
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const snapshot = (): PlayerState => ({
    libraryItem: { id: 'fixture', timeOffset: 0, videoId: null },
    selected: { stream: structuredClone(stream) },
    stream: { type: 'Ready', content: { source: structuredClone(stream.source) } },
    subtitles: [],
    title,
  });
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    dispatch: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    getState: (async () => snapshot()) as CoreTransport['getState'],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <PlayerScreen
        selection={{
          meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
          metaTransportUrl: 'https://addon.invalid/manifest.json',
          stream,
          streamTransportUrl: 'https://addon.invalid/manifest.json',
          video: null,
          nextVideo: null,
        }}
        settings={defaultSettings}
        preferredSubtitleLanguage={null}
        onBack={vi.fn()}
        onSettingsChange={vi.fn()}
        onSourceFailure={vi.fn()}
        onUpNext={vi.fn()}
      />
    </CoreContext.Provider>,
  );

  await waitFor(() => expect(native.startStreamingEngine).toHaveBeenCalledOnce());
  expect(await screen.findByText('Finding peers for this torrent…')).toBeInTheDocument();

  for (const next of ['Fixture — 30s', 'Fixture — 60s']) {
    title = next;
    await act(async () => {
      listeners.forEach((listener) => listener({ name: 'NewState', args: ['player'] }));
    });
  }

  expect(native.startStreamingEngine).toHaveBeenCalledOnce();
  expect(native.streamingEngineChanged.disconnect).not.toHaveBeenCalled();
});
