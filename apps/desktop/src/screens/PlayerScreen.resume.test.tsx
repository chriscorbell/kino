import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import { defaultSettings } from '../settings';
import { preview } from '../test/coreState';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  nativeShell: true,
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
  transport: { dispatch: vi.fn().mockResolvedValue(undefined) },
  unload: async () => {},
  native: {
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    load: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    seek: vi.fn(),
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
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
    state: {
      stream: { type: 'Ready', content: fixture.stream },
      libraryItem: { id: 'fixture', timeOffset: fixture.progress, videoId: null },
    },
    loading: false,
    error: null,
    unload: fixture.unload,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.progress = 0;
});

it.each([true, false])(
  'resumes delayed saved progress once with native=%s',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const props = {
      selection: {
        meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
        stream: fixture.stream,
        metaTransportUrl: 'https://addon.invalid/manifest.json',
        streamTransportUrl: 'https://addon.invalid/manifest.json',
        video: null,
        nextVideo: null,
      },
      settings: defaultSettings,
      preferredSubtitleLanguage: null,
      onBack: vi.fn(),
      onSourceFailure: vi.fn(),
      onUpNext: vi.fn(),
      onSettingsChange: vi.fn(),
    };
    const view = render(<PlayerScreen {...props} />);
    if (nativeShell) await waitFor(() => expect(fixture.native.load).toHaveBeenCalledTimes(1));
    const video = view.container.querySelector('video');
    await act(async () => {
      if (nativeShell)
        fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('duration', {
          milliseconds: 120000,
        });
      else {
        Object.defineProperty(video, 'duration', { value: 120, configurable: true });
        fireEvent.loadedMetadata(video!);
      }
    });
    fixture.progress = 30000;
    view.rerender(<PlayerScreen {...props} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('30000');
    fixture.progress = 45000;
    view.rerender(<PlayerScreen {...props} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (nativeShell) expect(fixture.native.seek.mock.calls).toEqual([[30]]);
    else expect(video!.currentTime).toBe(30);
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
      target: { value: '0' },
    });
    fixture.progress = 60000;
    view.rerender(<PlayerScreen {...props} />);
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('0');
    if (nativeShell) expect(fixture.native.seek).toHaveBeenLastCalledWith(0);
    else expect(video!.currentTime).toBe(0);
  },
);
