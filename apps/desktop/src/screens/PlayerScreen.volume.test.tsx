import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CoreSource } from '../core/types';
import { loadSettings } from '../settings';
import { preview } from '../test/coreState';
import { renderWithSettings } from '../test/renderWithSettings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
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
  transport: { dispatch: vi.fn().mockResolvedValue(undefined) },
  unload: async () => {},
  native: {
    load: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setSubtitleScale: vi.fn(),
    setSubtitlePosition: vi.fn(),
    setNowPlayingMetadata: vi.fn(),
  },
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => fixture.nativeShell,
  playbackDevice: () => (fixture.nativeShell ? 'kino-macos' : 'kino-web'),
  connectNativePlayer: async () => fixture.native,
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: fixture.transport }) }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: { stream: { type: 'Ready', content: fixture.stream } },
    loading: false,
    error: null,
    unload: fixture.unload,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
const selection = {
  meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
  stream: fixture.stream,
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: null,
  nextVideo: null,
};
const noop = () => {};
const renderPlayer = () =>
  renderWithSettings(
    <PlayerScreen
      selection={selection}
      preferredSubtitleLanguage={null}
      onBack={noop}
      onSourceFailure={noop}
      onUpNext={noop}
    />,
    { settings: { volume: 30 }, storage: localStorage },
  );
const reportVolume = (percent: number) =>
  act(async () => fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('volume', { percent }));
it.each([true, false])(
  'adjusts, saves and observes volume without reloading (native=%s)',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const view = renderPlayer();
    const range = await screen.findByRole('slider', { name: 'Volume' });
    if (nativeShell) {
      await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));
      await reportVolume(30);
    } else expect(view.container.querySelector('video')!.volume).toBe(0.3);
    expect(range).toHaveValue('30');
    fireEvent.change(range, { target: { value: '42' } });
    expect(loadSettings(localStorage).volume).toBe(42);
    expect(range).toHaveValue('42');
    expect(fireEvent.keyDown(window, { key: 'ArrowUp' })).toBe(false);
    expect(loadSettings(localStorage).volume).toBe(47);
    expect(fireEvent.keyDown(window, { key: 'ArrowDown' })).toBe(false);
    expect(loadSettings(localStorage).volume).toBe(42);
    expect(fireEvent.keyDown(range, { key: 'ArrowUp' })).toBe(true);
    expect(loadSettings(localStorage).volume).toBe(42);
    if (nativeShell) {
      expect(fixture.native.setVolume).toHaveBeenLastCalledWith(42);
      await reportVolume(65);
      expect(fixture.native.load).toHaveBeenCalledTimes(1);
    } else {
      const video = view.container.querySelector('video')!;
      expect(video.volume).toBe(0.42);
      video.volume = 0.65;
      fireEvent.volumeChange(video);
    }
    expect(range).toHaveValue('65');
    expect(loadSettings(localStorage).volume).toBe(65);
  },
);

it('keeps the newest volume when a report of an older one arrives late', async () => {
  fixture.nativeShell = true;
  renderPlayer();
  const range = await screen.findByRole('slider', { name: 'Volume' });
  await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));
  await reportVolume(30);

  fireEvent.change(range, { target: { value: '42' } });
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  await reportVolume(42);

  expect(loadSettings(localStorage).volume).toBe(47);
  expect(range).toHaveValue('47');
  await reportVolume(47);
  await reportVolume(65);
  expect(loadSettings(localStorage).volume).toBe(65);
});

it("keeps the saved volume when the player reports its own default before Kino's", async () => {
  fixture.nativeShell = true;
  renderPlayer();
  await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));

  await reportVolume(100);

  expect(loadSettings(localStorage).volume).toBe(30);
  expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('30');
});
