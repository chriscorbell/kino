import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import { preview } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback, resolvedPlayer } from '../test/playback';

const fixture = {
  progress: 0,
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
beforeEach(() => {
  vi.clearAllMocks();
  fixture.progress = 0;
});

it.each([true, false])(
  'resumes delayed saved progress once with native=%s',
  async (nativeShell) => {
    const selection = {
      meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
      stream: fixture.stream,
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      streamTransportUrl: 'https://addon.invalid/manifest.json',
      video: null,
      nextVideo: null,
    };
    const { publish, view } = await mountPlayback({
      selection,
      native: nativeShell ? fixture.native : null,
      player: () => ({
        ...resolvedPlayer(selection),
        libraryItem: { id: 'fixture', timeOffset: fixture.progress, videoId: null },
      }),
    });
    if (nativeShell) await waitFor(() => expect(fixture.native.load).toHaveBeenCalledTimes(1));
    const video = view.container.querySelector('video');
    await act(async () => {
      if (nativeShell)
        fixture.native.playerEvent.fire('duration', {
          milliseconds: 120000,
        });
      else {
        Object.defineProperty(video, 'duration', { value: 120, configurable: true });
        fireEvent.loadedMetadata(video!);
      }
    });
    fixture.progress = 30000;
    await publish();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('30000');
    fixture.progress = 45000;
    await publish();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (nativeShell) expect(fixture.native.seek.mock.calls).toEqual([[30]]);
    else expect(video!.currentTime).toBe(30);
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
      target: { value: '0' },
    });
    fixture.progress = 60000;
    await publish();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('0');
    if (nativeShell) expect(fixture.native.seek).toHaveBeenLastCalledWith(0);
    else expect(video!.currentTime).toBe(0);
  },
);
