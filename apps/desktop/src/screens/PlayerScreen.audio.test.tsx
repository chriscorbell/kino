import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import { preview } from '../test/coreState';
import { renderWithSettings } from '../test/renderWithSettings';
import { PlayerScreen } from './PlayerScreen';

const fixture = await vi.hoisted(async () => {
  const { fakeNativePlayer } = await import('../test/nativePlayer');
  return {
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
    native: fakeNativePlayer({ loadWithAudioLanguage: vi.fn(), setMatchFrameRate: vi.fn() }),
  };
});
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  knownShellReport: () => ({ platform: 'macos', capabilities: new Set() }),
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
  renderWithSettings(
    <PlayerScreen
      selection={{
        meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
        stream: fixture.stream,
        metaTransportUrl: 'https://addon.invalid/manifest.json',
        streamTransportUrl: 'https://addon.invalid/manifest.json',
        video: null,
        nextVideo: null,
      }}
      preferredAudioLanguage="spa"
      preferredSubtitleLanguage={null}
      onBack={vi.fn()}
      onSourceFailure={vi.fn()}
      onUpNext={vi.fn()}
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
  // The refresh-rate preference reaches the shell before the file it applies to.
  expect(fixture.native.setMatchFrameRate).toHaveBeenCalledWith(false);
  expect(fixture.native.setMatchFrameRate.mock.invocationCallOrder[0]).toBeLessThan(
    fixture.native.loadWithAudioLanguage.mock.invocationCallOrder[0]!,
  );
  expect(menu).toBeDisabled();
  await fixture.native.emit('audioTracks', {
    items: [
      { id: 1, lang: 'eng', codec: 'aac', selected: false },
      { id: 2, lang: 'spa', codec: 'aac', selected: true },
      { id: 0, lang: 'invalid' },
    ],
  });
  fireEvent.click(menu);
  const spanish = screen.getByRole('button', { name: 'Spanish · AAC' });
  expect(spanish).toHaveAttribute('aria-pressed', 'true');
  expect(spanish).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'English · AAC' }));
  expect(fixture.native.setAudioTrack).toHaveBeenCalledExactlyOnceWith(1);
  expect(menu).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fixture.native.loadWithAudioLanguage).toHaveBeenCalledTimes(1);
  await fixture.native.emit('audioTracks', {
    items: [
      { id: 1, lang: 'eng', codec: 'aac', selected: true },
      { id: 2, lang: 'spa', codec: 'aac', selected: false },
    ],
  });
  fireEvent.click(menu);
  expect(screen.getByRole('button', { name: 'English · AAC' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
