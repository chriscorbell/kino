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
    native: fakeNativePlayer(),
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

it('gives subtitle variants distinct visible and accessible names and selects their native IDs', async () => {
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
      preferredSubtitleLanguage={null}
      onBack={vi.fn()}
      onSourceFailure={vi.fn()}
      onUpNext={vi.fn()}
    />,
  );
  const menu = await screen.findByRole('button', { name: 'Subtitles' });
  await waitFor(() => expect(fixture.native.load).toHaveBeenCalledTimes(1));
  await fixture.native.emit('subtitleTracks', {
    items: [
      { id: 1, lang: 'eng', codec: 'subrip', title: 'English SDH', hearingImpaired: true },
      { id: 2, lang: 'eng', codec: 'subrip', title: 'English Forced', forced: true },
      { id: 4, lang: 'eng', codec: 'subrip' },
      { id: 7, lang: 'eng', codec: 'subrip' },
    ],
  });
  fireEvent.click(menu);
  expect(fixture.native.load).toHaveBeenCalledTimes(1);
  const names = [
    'English SDH · SRT',
    'English Forced · SRT',
    'English · SRT · Track 4',
    'English · SRT · Track 7',
  ] as const;
  for (const name of names) expect(screen.getByRole('button', { name })).toHaveTextContent(name);
  fixture.native.setSubtitleTrack.mockClear();
  fireEvent.click(screen.getByRole('button', { name: names[1] }));
  expect(fixture.native.setSubtitleTrack).toHaveBeenCalledExactlyOnceWith(2);
});
