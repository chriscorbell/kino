import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  stream: { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } },
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
  await screen.findByRole('button', { name: 'Subtitles' });
}

it('lets Space activate the focused subtitle option without toggling playback', async () => {
  await mountPlayer();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Subtitles' }));
  screen.getByRole('button', { name: 'Off' }).focus();
  await user.keyboard(' ');
  expect(fixture.native.setSubtitleTrack).toHaveBeenCalledExactlyOnceWith(0);
  expect(fixture.native.setPaused).not.toHaveBeenCalled();
});

it('leaves arrows on the focused timeline to the range control', async () => {
  await mountPlayer();
  const range = screen.getByRole('slider', { name: 'Playback position' });
  const allowed = fireEvent.keyDown(range, { key: 'ArrowRight', code: 'ArrowRight' });
  expect(allowed).toBe(true);
  expect(fixture.native.seek).not.toHaveBeenCalled();
});

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
  { repeat: true },
  { isComposing: true },
])('ignores global shortcuts with %j', async (extra) => {
  await mountPlayer();
  expect(fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ...extra })).toBe(true);
  expect(fixture.native.setPaused).not.toHaveBeenCalled();
});

it('ignores handled events and typing in an editable element', async () => {
  await mountPlayer();
  const handled = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', cancelable: true });
  handled.preventDefault();
  window.dispatchEvent(handled);
  const editable = document.createElement('div');
  editable.contentEditable = 'true';
  editable.setAttribute('contenteditable', 'true');
  document.body.append(editable);
  expect(fireEvent.keyDown(editable, { key: 'k', code: 'KeyK' })).toBe(true);
  editable.remove();
  expect(fixture.native.setPaused).not.toHaveBeenCalled();
});

it('keeps unmodified playback shortcuts available on the player background', async () => {
  await mountPlayer();
  expect(fireEvent.keyDown(window, { key: 'k', code: 'KeyK' })).toBe(false);
  expect(fixture.native.setPaused).toHaveBeenCalledExactlyOnceWith(false);
  expect(fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' })).toBe(false);
  expect(fixture.native.seek).toHaveBeenCalledExactlyOnceWith(10);
});

it('toggles from actual native fullscreen state and exits with Escape from focused controls', async () => {
  await mountPlayer();
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  expect(fixture.native.setFullscreen).toHaveBeenLastCalledWith(true);
  act(() => {
    fixture.native.fullscreen = true;
    fixture.native.fullscreenChanged.connect.mock.lastCall?.[0]();
  });
  const exit = screen.getByRole('button', { name: 'Exit fullscreen' });
  fireEvent.click(exit);
  expect(fixture.native.setFullscreen).toHaveBeenLastCalledWith(false);
  fixture.native.setFullscreen.mockClear();
  fireEvent.keyDown(window, { key: 'f', code: 'KeyF' });
  expect(fixture.native.setFullscreen).toHaveBeenLastCalledWith(false);
  fixture.native.setFullscreen.mockClear();
  fireEvent.keyDown(exit, { key: 'Escape', code: 'Escape' });
  expect(fixture.native.setFullscreen).toHaveBeenLastCalledWith(false);
});

it('uses Escape to close subtitles before exiting fullscreen', async () => {
  fixture.native.fullscreen = true;
  await mountPlayer();
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Off' })).not.toBeInTheDocument();
  expect(fixture.native.setFullscreen).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  expect(fixture.native.setFullscreen).toHaveBeenLastCalledWith(false);
});
