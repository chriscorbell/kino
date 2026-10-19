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
// mpv applies commands in order and reports an observed property only when it
// differs from the last value it reported, so quick changes merge into one
// report and a volume it already holds is never reported.
const mpv = { holds: 100, reported: null as number | null, queued: [] as number[] };
const mpvReports = () =>
  act(async () => {
    if (mpv.holds === mpv.reported) return;
    mpv.reported = mpv.holds;
    fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0]('volume', { percent: mpv.holds });
  });
const mpvApplies = () => {
  mpv.holds = mpv.queued.at(-1) ?? mpv.holds;
  mpv.queued = [];
  return mpvReports();
};
const mpvChangesOnItsOwn = (percent: number) => {
  mpv.holds = percent;
  return mpvReports();
};
const realNow = performance.now.bind(performance);
let skipped = 0;
const skipAhead = (milliseconds: number) => {
  skipped += milliseconds;
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(mpv, { holds: 100, reported: 100, queued: [] });
  fixture.native.setVolume.mockImplementation((percent: number) => mpv.queued.push(percent));
  skipped = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skipped);
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
const renderPlayer = (volume = 30) =>
  renderWithSettings(
    <PlayerScreen
      selection={selection}
      preferredSubtitleLanguage={null}
      onBack={noop}
      onSourceFailure={noop}
      onUpNext={noop}
    />,
    { settings: { volume }, storage: localStorage },
  );
const volumeSlider = () => screen.findByRole('slider', { name: 'Volume' });

it.each([true, false])(
  'adjusts, saves and observes volume without reloading (native=%s)',
  async (nativeShell) => {
    fixture.nativeShell = nativeShell;
    const view = renderPlayer();
    const range = await volumeSlider();
    if (nativeShell) {
      await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));
      await mpvApplies();
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
      await mpvApplies();
      skipAhead(1000);
      await mpvChangesOnItsOwn(65);
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

it.each([
  { player: 'mpv at its default', nativeShell: true, saved: 100 },
  { player: 'mpv on a second title', nativeShell: true, saved: 65 },
  { player: '<video> at its default', nativeShell: false, saved: 100 },
])(
  'saves a change the player makes when it already held the saved volume ($player)',
  async ({ nativeShell, saved }) => {
    fixture.nativeShell = nativeShell;
    Object.assign(mpv, { holds: saved, reported: saved });
    const view = renderPlayer(saved);
    const range = await volumeSlider();
    if (nativeShell) {
      await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(saved));
      await mpvApplies();
    }
    skipAhead(1000);

    if (nativeShell) await mpvChangesOnItsOwn(30);
    else
      act(() => {
        view.container.querySelector('video')!.volume = 0.3;
      });

    expect(loadSettings(localStorage).volume).toBe(30);
    expect(range).toHaveValue('30');
  },
);

it("keeps the viewer's step when an older volume is reported before it applies", async () => {
  fixture.nativeShell = true;
  renderPlayer();
  const range = await volumeSlider();
  await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));
  await mpvApplies();

  fireEvent.keyDown(window, { key: 'ArrowUp' });
  await mpvChangesOnItsOwn(20);
  await mpvApplies();

  expect(fixture.native.setVolume).toHaveBeenLastCalledWith(35);
  expect(loadSettings(localStorage).volume).toBe(35);
  expect(range).toHaveValue('35');
});

it("keeps the saved volume when mpv reports its start-up default after Kino's send", async () => {
  fixture.nativeShell = true;
  mpv.reported = null;
  renderPlayer();
  const range = await volumeSlider();
  await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(30));

  await mpvReports();
  expect(loadSettings(localStorage).volume).toBe(30);
  await mpvApplies();

  expect(loadSettings(localStorage).volume).toBe(30);
  expect(range).toHaveValue('30');
});

it('saves a change to a value whose send mpv merged away, once that send expires', async () => {
  fixture.nativeShell = true;
  Object.assign(mpv, { holds: 42, reported: 42 });
  renderPlayer(42);
  const range = await volumeSlider();
  await waitFor(() => expect(fixture.native.setVolume).toHaveBeenCalledWith(42));

  fireEvent.keyDown(window, { key: 'ArrowUp' });
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  await mpvApplies();
  skipAhead(1000);
  await mpvChangesOnItsOwn(47);

  expect(loadSettings(localStorage).volume).toBe(47);
  expect(range).toHaveValue('47');
});
