import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  stream: { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } },
  native: {
    load: vi.fn(),
    stop: vi.fn(),
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setSubtitleTrack: vi.fn(),
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
  useCore: () => ({ transport: { dispatch: async () => {} } }),
}));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: { stream: { type: 'Ready', content: fixture.stream } },
    loading: false,
    error: null,
    unload: async () => {},
  }),
}));

it('gives subtitle variants distinct visible and accessible names and selects their native IDs', async () => {
  render(
    <PlayerScreen
      selection={{
        meta: { id: 'fixture', type: 'movie', name: 'Fixture', inLibrary: false, watched: false },
        stream: fixture.stream,
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
  const menu = await screen.findByRole('button', { name: 'Subtitles' });
  await act(async () => {
    fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('subtitleTracks', {
      items: [
        { id: 1, lang: 'eng', codec: 'subrip', title: 'English SDH', hearingImpaired: true },
        { id: 2, lang: 'eng', codec: 'subrip', title: 'English Forced', forced: true },
        { id: 4, lang: 'eng', codec: 'subrip' },
        { id: 7, lang: 'eng', codec: 'subrip' },
      ],
    });
  });
  fireEvent.click(menu);
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
