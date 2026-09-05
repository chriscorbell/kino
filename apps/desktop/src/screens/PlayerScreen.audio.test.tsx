import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import { defaultSettings } from '../settings';
import { preview } from '../test/coreState';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
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
  unload: vi.fn().mockResolvedValue(undefined),
  native: {
    load: vi.fn(),
    loadWithAudioLanguage: vi.fn(),
    stop: vi.fn(),
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setAudioTrack: vi.fn(),
    setSubtitleTrack: vi.fn(),
    setVolume: vi.fn(),
    setSubtitleScale: vi.fn(),
    setSubtitlePosition: vi.fn(),
    setNowPlayingMetadata: vi.fn(),
  },
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  connectNativePlayer: async () => fixture.native,
}));
vi.mock('../core/context', () => ({
  useCore: () => ({ transport: fixture.transport }),
}));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: { stream: { type: 'Ready', content: fixture.stream } },
    loading: false,
    error: null,
    unload: fixture.unload,
  }),
}));

it('passes the preferred language and selects native audio IDs without reloading playback', async () => {
  render(
    <PlayerScreen
      selection={{
        meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
        stream: fixture.stream,
        metaTransportUrl: 'https://addon.invalid/manifest.json',
        streamTransportUrl: 'https://addon.invalid/manifest.json',
        video: null,
        nextVideo: null,
      }}
      settings={defaultSettings}
      preferredAudioLanguage="spa"
      preferredSubtitleLanguage={null}
      onBack={vi.fn()}
      onSourceFailure={vi.fn()}
      onUpNext={vi.fn()}
      onSettingsChange={vi.fn()}
    />,
  );
  const menu = await screen.findByRole('button', { name: 'Audio tracks' });
  await waitFor(() =>
    expect(fixture.native.loadWithAudioLanguage).toHaveBeenCalledExactlyOnceWith(
      'https://media.invalid/fixture.mp4',
      false,
      {},
      'spa',
    ),
  );
  expect(menu).toBeDisabled();
  const event = fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0];
  act(() =>
    event('audioTracks', {
      items: [
        { id: 1, lang: 'eng', codec: 'aac', selected: false },
        { id: 2, lang: 'spa', codec: 'aac', selected: true },
        { id: 0, lang: 'invalid' },
      ],
    }),
  );
  fireEvent.click(menu);
  const spanish = screen.getByRole('button', { name: 'Spanish · AAC' });
  expect(spanish).toHaveAttribute('aria-pressed', 'true');
  expect(spanish).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'English · AAC' }));
  expect(fixture.native.setAudioTrack).toHaveBeenCalledExactlyOnceWith(1);
  expect(menu).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fixture.native.loadWithAudioLanguage).toHaveBeenCalledTimes(1);
  act(() =>
    event('audioTracks', {
      items: [
        { id: 1, lang: 'eng', codec: 'aac', selected: true },
        { id: 2, lang: 'spa', codec: 'aac', selected: false },
      ],
    }),
  );
  fireEvent.click(menu);
  expect(screen.getByRole('button', { name: 'English · AAC' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
