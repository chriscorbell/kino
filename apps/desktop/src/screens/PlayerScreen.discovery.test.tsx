import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import { hints, preview, urlSource } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback } from '../test/playback';

const fixture = {
  nativeShell: true,
  stream: {
    description: null,
    name: null,
    source: { kind: 'url', url: 'https://media.invalid/fixture.mp4' },
    hints: {
      bingeGroup: null,
      countryWhitelist: null,
      filename: null,
      notWebReady: null,
      proxyRequestHeaders: null,
      proxyResponseHeaders: null,
      videoHash: null,
      videoSize: null,
    },
  } satisfies CoreSource,
  native: fakeNativePlayer(),
};
beforeEach(() => vi.clearAllMocks());

it.each([true, false])(
  'discovers subtitles once media is ready (native=%s)',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const {
      reports,
      view: { container },
    } = await renderPlayer(fixture.stream);
    if (nativeShell) await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
    expect(reports).not.toHaveBeenCalled();
    await act(async () => {
      for (let count = 0; count < 2; count++) {
        if (nativeShell) fixture.native.playerEvent.fire('ready', {});
        else fireEvent.loadedMetadata(container.querySelector('video')!);
      }
    });
    expect(reports).toHaveBeenCalledExactlyOnceWith(
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
  const { reports } = await renderPlayer(
    urlSource('https://media.invalid/fixture.mp4', {
      hints: hints({ videoHash: '0123456789abcdef', videoSize: 123456, filename: 'fixture.mkv' }),
    }),
  );
  await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
  await fixture.native.emit('ready');
  expect(reports).toHaveBeenCalledWith(
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

function renderPlayer(stream: CoreSource) {
  return mountPlayback({
    selection: {
      meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
      stream,
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      streamTransportUrl: 'https://addon.invalid/manifest.json',
      video: null,
      nextVideo: null,
    },
    native: fixture.nativeShell ? fixture.native : null,
  });
}
