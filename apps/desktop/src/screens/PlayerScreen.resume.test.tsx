import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  nativeShell: true,
  progress: 0,
  stream: { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } },
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
      libraryItem: { _id: 'fixture', state: { timeOffset: fixture.progress } },
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

it.each([
  [true, 'resume'],
  [true, 'start-over'],
  [false, 'resume'],
  [false, 'start-over'],
] as const)(
  'handles delayed saved progress with native=%s, mode=%s',
  async (nativeShell, resumeMode) => {
    fixture.nativeShell = nativeShell;
    const props = {
      selection: {
        meta: { id: 'fixture', type: 'movie', name: 'Fixture', inLibrary: false, watched: false },
        stream: fixture.stream,
        metaTransportUrl: 'https://addon.invalid/manifest.json',
        streamTransportUrl: 'https://addon.invalid/manifest.json',
        video: null,
        nextVideo: null,
        resumeMode,
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
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue(
      resumeMode === 'resume' ? '30000' : '0',
    );
    fixture.progress = 45000;
    view.rerender(<PlayerScreen {...props} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (nativeShell)
      expect(fixture.native.seek.mock.calls).toEqual(resumeMode === 'resume' ? [[30]] : []);
    else expect(video!.currentTime).toBe(resumeMode === 'resume' ? 30 : 0);
  },
);
