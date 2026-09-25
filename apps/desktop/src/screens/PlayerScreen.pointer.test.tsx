import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

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
    fullscreen: false,
    fullscreenChanged: {
      connect: vi.fn<(listener: () => void) => void>(),
      disconnect: vi.fn(),
    },
    load: vi.fn(),
    stop: vi.fn(),
    pauseAndSnapshot: vi.fn().mockResolvedValue({ time: 0, duration: 0 }),
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setPaused: vi.fn(),
    seek: vi.fn(),
    setMuted: vi.fn(),
    setFullscreen: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  fixture.native.fullscreen = false;
});

async function mountPlayer() {
  const onBack = vi.fn();
  const view = render(
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
      preferredSubtitleLanguage={null}
      onBack={onBack}
      onSourceFailure={vi.fn()}
      onUpNext={vi.fn()}
      onSettingsChange={vi.fn()}
    />,
  );
  await screen.findByRole('button', { name: 'Subtitles' });
  await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
  const emit = (name: string, payload: Record<string, unknown>) =>
    act(() => {
      for (const [listener] of fixture.native.playerEvent.connect.mock.calls)
        (listener as (name: string, payload: Record<string, unknown>) => void)(name, payload);
    });
  return { container: view.container, emit, onBack };
}

it('plays or pauses on a click on the picture and toggles fullscreen on a double click', async () => {
  const { container } = await mountPlayer();
  const surface = container.querySelector<HTMLElement>('[class*="playerSurface"]')!;
  fireEvent.click(surface);
  expect(fixture.native.setPaused).toHaveBeenLastCalledWith(false);
  fireEvent.doubleClick(surface);
  expect(fixture.native.setFullscreen).toHaveBeenCalledWith(true);
});

it('shows the time under the pointer on the timeline', async () => {
  const { emit } = await mountPlayer();
  await emit('duration', { milliseconds: 600_000 });
  const timeline = screen.getByRole('slider', { name: 'Playback position' }).parentElement!;
  timeline.getBoundingClientRect = () =>
    ({ left: 100, width: 400, top: 0, height: 18, right: 500, bottom: 18 }) as DOMRect;
  fireEvent.pointerMove(timeline, { clientX: 200 });
  expect(timeline).toHaveTextContent('2:30');
  fireEvent.pointerLeave(timeline);
  expect(timeline).not.toHaveTextContent('2:30');
});

it('says progress is being saved while Back waits for the save', async () => {
  let finish!: () => void;
  fixture.unload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const { onBack } = await mountPlayer();
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect(await screen.findByText('Saving progress…')).toBeInTheDocument();
  expect(onBack).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(onBack).toHaveBeenCalledOnce();
});

it('moves focus into the subtitle panel and back to its button', async () => {
  await mountPlayer();
  const toggle = screen.getByRole('button', { name: 'Subtitles' });
  fireEvent.click(toggle);
  const panel = screen.getByRole('dialog', { name: 'Subtitles' });
  await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));
  expect(document.activeElement).toHaveAccessibleName('Off');
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(toggle).toHaveFocus());
});

it('shows how far the native player has read ahead', async () => {
  const { emit } = await mountPlayer();
  await emit('duration', { milliseconds: 600_000 });
  await emit('buffered', { milliseconds: 150_000 });
  const timeline = screen.getByRole('slider', { name: 'Playback position' }).parentElement!;
  expect(timeline.querySelector<HTMLElement>('[class*="bufferedRange"]')?.style.width).toBe('25%');
});
