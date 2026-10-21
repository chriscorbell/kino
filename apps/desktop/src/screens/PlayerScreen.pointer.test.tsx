import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import type { PlayerCorePort } from '../playback/types';
import { preview } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback } from '../test/playback';

const fixture = {
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
  commit: vi.fn<PlayerCorePort['commit']>().mockResolvedValue(undefined),
  native: fakeNativePlayer(),
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.native.fullscreen = false;
});

async function mountPlayer() {
  const { onFinished, view } = await mountPlayback({
    selection: {
      meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
      stream: fixture.stream,
      metaTransportUrl: 'https://addon.invalid/manifest.json',
      streamTransportUrl: 'https://addon.invalid/manifest.json',
      video: null,
    },
    native: fixture.native,
    core: { commit: fixture.commit },
  });
  await screen.findByRole('button', { name: 'Subtitles' });
  await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
  return { container: view.container, emit: fixture.native.emit, onFinished };
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
  fixture.commit.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const { onFinished } = await mountPlayer();
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect(await screen.findByText('Saving progress…')).toBeInTheDocument();
  expect(onFinished).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' }));
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
