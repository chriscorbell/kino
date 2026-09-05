import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { CoreStream } from '../core/types';
import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  nativeShell: true,
  stream: { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } },
  transport: { dispatch: vi.fn().mockResolvedValue(undefined) },
  native: {
    load: vi.fn(),
    stop: vi.fn(),
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setVolume: vi.fn(),
    setSubtitleScale: vi.fn(),
    setSubtitlePosition: vi.fn(),
    setNowPlayingMetadata: vi.fn(),
  },
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => fixture.nativeShell,
  connectNativePlayer: async () => fixture.native,
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: fixture.transport }) }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: { stream: { type: 'Ready', content: fixture.stream } },
    loading: false,
    error: null,
    unload: async () => {},
  }),
}));
beforeEach(() => vi.clearAllMocks());

it.each([true, false])(
  'discovers subtitles once media is ready (native=%s)',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const { container } = renderPlayer(fixture.stream);
    if (nativeShell) await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
    expect(fixture.transport.dispatch).not.toHaveBeenCalled();
    await act(async () => {
      for (let count = 0; count < 2; count++) {
        if (nativeShell) fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('ready', {});
        else fireEvent.loadedMetadata(container.querySelector('video')!);
      }
    });
    expect(fixture.transport.dispatch).toHaveBeenCalledExactlyOnceWith(
      {
        action: 'Player',
        args: {
          action: 'VideoParamsChanged',
          args: { videoParams: { hash: null, size: null, filename: null } },
        },
      },
      'player',
    );
  },
);

it('includes supplied file hints when reporting native readiness', async () => {
  fixture.nativeShell = true;
  renderPlayer({
    ...fixture.stream,
    behaviorHints: { videoHash: '0123456789abcdef', videoSize: 123456, filename: 'fixture.mkv' },
  });
  await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
  await act(async () => fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('ready', {}));
  expect(fixture.transport.dispatch).toHaveBeenCalledWith(
    {
      action: 'Player',
      args: {
        action: 'VideoParamsChanged',
        args: {
          videoParams: { hash: '0123456789abcdef', size: 123456, filename: 'fixture.mkv' },
        },
      },
    },
    'player',
  );
});

function renderPlayer(stream: CoreStream) {
  return render(
    <PlayerScreen
      selection={{
        meta: { id: 'fixture', type: 'movie', name: 'Fixture', inLibrary: false, watched: false },
        stream,
        metaTransportUrl: 'https://addon.invalid/manifest.json',
        streamTransportUrl: 'https://addon.invalid/manifest.json',
        video: null,
        nextVideo: null,
      }}
      settings={defaultSettings}
      preferredSubtitleLanguage={null}
      onBack={vi.fn()}
      onSourceFailure={vi.fn()}
      onUpNext={vi.fn()}
      onSettingsChange={vi.fn()}
    />,
  );
}
