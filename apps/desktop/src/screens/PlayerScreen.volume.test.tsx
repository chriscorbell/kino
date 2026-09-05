import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  nativeShell: true,
  stream: { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } },
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
  meta: { id: 'fixture', type: 'movie', name: 'Fixture', inLibrary: false, watched: false },
  stream: fixture.stream,
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: null,
  nextVideo: null,
};
const noop = () => {};
function Fixture() {
  const [settings, setSettings] = useState({ ...defaultSettings, volume: 30 });
  return (
    <PlayerScreen
      selection={selection}
      settings={settings}
      onSettingsChange={(next) => {
        saveSettings(localStorage, next);
        setSettings(next);
      }}
      preferredSubtitleLanguage={null}
      onBack={noop}
      onSourceFailure={noop}
      onUpNext={noop}
    />
  );
}
it.each([true, false])(
  'adjusts, saves and observes volume without reloading (native=%s)',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const view = render(<Fixture />);
    const range = await screen.findByRole('slider', { name: 'Volume' });
    if (nativeShell) await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));
    else expect(view.container.querySelector('video')!.volume).toBe(0.3);
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
      await act(async () =>
        fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('volume', { percent: 65 }),
      );
      expect(fixture.native.load).toHaveBeenCalledTimes(1);
    } else {
      const video = view.container.querySelector('video')!;
      expect(video.volume).toBe(0.42);
      video.volume = 0.65;
      fireEvent.volumeChange(video);
    }
    expect(range).toHaveValue('65');
  },
);
