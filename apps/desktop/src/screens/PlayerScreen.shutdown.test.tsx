import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preview, urlSource, video } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback, resolvedPlayer } from '../test/playback';
import { commitThrough } from '../test/transport';

const native = fakeNativePlayer();

beforeEach(() => {
  vi.clearAllMocks();
  native.pauseAndSnapshot.mockResolvedValue({ time: 0, duration: 0 });
});

async function mountPlayer({ upNext = true, hasNextVideo = true } = {}) {
  const calls: string[] = [];
  const closing = new Set<() => Promise<void>>();
  let holdFlush = false;
  let finishFlush!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishFlush = resolve;
  });
  const dispatch = vi.fn(async (action: { action: string; args?: unknown }) => {
    const args = action.args as { action?: string; args?: { time?: number } } | undefined;
    calls.push(
      action.action === 'Player' ? `${args?.action}:${args?.args?.time ?? ''}` : action.action,
    );
  });
  const flush = vi.fn(async () => {
    calls.push('flush');
    if (holdFlush) await pending;
    calls.push('saved');
  });
  const transport = {
    dispatch,
    onBeforeDestroy: (callback: () => Promise<void>) => {
      closing.add(callback);
      return () => closing.delete(callback);
    },
    prepareClose: async () => {
      await Promise.all([...closing].map((callback) => callback()));
    },
    // CoreProvider's teardown closes the transport the same way.
    destroy: () => transport.prepareClose(),
    flush,
    commit: commitThrough(dispatch, flush),
  };
  const nextVideo = video({ id: 'ep2', title: 'Episode two', season: 1, episode: 2 });
  const selection = {
    meta: preview({ id: 'show', name: 'Test series', type: 'series' }),
    stream: urlSource('https://media.invalid/fixture.mp4'),
    streamTransportUrl: 'https://addon.invalid/manifest.json',
    metaTransportUrl: 'https://addon.invalid/manifest.json',
    video: video({ id: 'ep1', title: 'Episode one', season: 1, episode: 1 }),
  };
  const { onFinished, view } = await mountPlayback({
    selection,
    player: () => ({ ...resolvedPlayer(selection), nextVideo: hasNextVideo ? nextVideo : null }),
    native,
    core: transport,
    settings: { upNext },
    strict: true,
  });
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  const { emit } = native;
  await emit('duration', { milliseconds: 120000 });
  await emit('time', { milliseconds: 30000 });
  await emit('time', { milliseconds: 34567 });
  native.pauseAndSnapshot.mockResolvedValue({ time: 34567, duration: 120000 });
  const mounted = calls.splice(0);
  holdFlush = true;
  return {
    calls,
    closing,
    emit,
    finishFlush,
    mounted,
    nextVideo,
    onFinished,
    transport,
    view,
  };
}

describe('ordered playback shutdown', () => {
  it('keeps playback open on a failed save and retries without losing the captured position', async () => {
    const player = await mountPlayer();
    native.stop.mockClear();
    player.transport.flush.mockRejectedValueOnce(new Error('Storage is full.'));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await screen.findByRole('alert');
    expect(player.onFinished).not.toHaveBeenCalled();
    expect(player.calls).not.toContain('Unload');
    expect(native.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await act(async () => player.finishFlush());
    await waitFor(() =>
      expect(player.onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' }),
    );
    expect(player.calls.filter((call) => call === 'TimeChanged:34567')).toHaveLength(2);
    expect(native.stop).toHaveBeenCalledOnce();
  });

  it('shares one save when Back and native close happen together', async () => {
    const player = await mountPlayer();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    const closing = player.transport.prepareClose();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(player.calls).toContain('TimeChanged:34567'));
    await act(async () => {
      player.finishFlush();
      await closing;
    });
    expect(player.calls.filter((call) => call === 'TimeChanged:34567')).toHaveLength(1);
    expect(player.calls.filter((call) => call === 'Unload')).toHaveLength(1);
    expect(player.onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' });
  });

  // `teardown` is CoreProvider destroying the transport, as on a Core session change.
  it.each(['Back', 'failure', 'Up Next', 'near-end Up Next', 'native close', 'teardown'] as const)(
    'saves the latest position before unload on %s',
    async (exit) => {
      const player = await mountPlayer();
      let closing: Promise<void> | undefined;
      if (exit === 'Back') fireEvent.click(screen.getByRole('button', { name: /Back/ }));
      if (exit === 'failure') await player.emit('error', { code: 'decoder-or-stream-failed' });
      if (exit === 'Up Next' || exit === 'near-end Up Next') {
        if (exit === 'Up Next') await player.emit('ended');
        else await player.emit('time', { milliseconds: 108000 });
        fireEvent.click(screen.getByRole('button', { name: /Choose source/i }));
      }
      if (exit === 'native close') {
        expect(player.closing.size).toBe(1);
        closing = player.transport.prepareClose();
      }
      if (exit === 'teardown') closing = player.transport.destroy();
      await waitFor(() => expect(player.calls).toContain('TimeChanged:34567'));
      expect(player.calls).not.toContain('Unload');
      expect(player.onFinished).not.toHaveBeenCalled();
      await act(async () => {
        player.finishFlush();
        await closing;
      });
      await waitFor(() => expect(player.calls).toContain('Unload'));
      expect(player.calls.indexOf('TimeChanged:34567')).toBeLessThan(player.calls.indexOf('saved'));
      expect(player.calls.indexOf('saved')).toBeLessThan(player.calls.indexOf('Unload'));
      expect(player.calls.filter((call) => call === 'Unload')).toHaveLength(1);
      const outcome = {
        Back: { kind: 'back' },
        failure: { kind: 'failed', message: expect.any(String) },
        'Up Next': { kind: 'upNext', video: player.nextVideo },
        'near-end Up Next': { kind: 'upNext', video: player.nextVideo },
        'native close': { kind: 'closed' },
        teardown: { kind: 'closed' },
      }[exit];
      expect(player.onFinished).toHaveBeenCalledExactlyOnceWith(outcome);
    },
  );
});

it('tells the viewer when the native player could not start', async () => {
  const player = await mountPlayer();
  await player.emit('error', { code: 'player-unavailable' });
  await waitFor(() => expect(player.calls).toContain('TimeChanged:34567'));
  await act(async () => player.finishFlush());
  await waitFor(() =>
    expect(player.onFinished).toHaveBeenCalledExactlyOnceWith({
      kind: 'failed',
      message: 'Kino could not start the native player. Quit and reopen Kino to try again.',
    }),
  );
});

it('says progress is being saved while window close waits for the save', async () => {
  const player = await mountPlayer();
  const closing = player.transport.prepareClose();
  expect(await screen.findByText('Saving progress…')).toBeInTheDocument();
  expect(player.onFinished).not.toHaveBeenCalled();
  await act(async () => {
    player.finishFlush();
    await closing;
  });
  expect(player.onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'closed' });
});

it('sends one Load and saves nothing while StrictMode mounts the view twice', async () => {
  const { mounted } = await mountPlayer();
  expect(mounted.filter((call) => call === 'Load')).toHaveLength(1);
  expect(mounted).not.toContain('flush');
  expect(mounted).not.toContain('Unload');
  expect(native.load).toHaveBeenCalledOnce();
  expect(native.stop).not.toHaveBeenCalled();
});

it('neither saves nor unloads when the view unmounts while playing', async () => {
  const player = await mountPlayer();
  player.view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(player.calls).toEqual([]);
  expect(native.stop).not.toHaveBeenCalled();
  expect(player.onFinished).not.toHaveBeenCalled();
});

describe('near-end Up Next', () => {
  it.each([
    { duration: 1_800_000, start: 1_680_000 },
    { duration: 120_000, start: 108_000 },
  ])(
    'offers the next source at $start ms of $duration ms without starting it',
    async ({ duration, start }) => {
      const player = await mountPlayer();
      await player.emit('duration', { milliseconds: duration });
      await player.emit('time', { milliseconds: start - 1 });
      expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
      await player.emit('time', { milliseconds: start });
      expect(screen.getByRole('button', { name: /Choose source/i })).toBeInTheDocument();
      expect(player.onFinished).not.toHaveBeenCalled();
      expect(player.calls).not.toContain('Unload');
      const loads = native.load.mock.calls.length;
      await player.emit('time', { milliseconds: start - 1 });
      expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
      expect(native.load).toHaveBeenCalledTimes(loads);
    },
  );

  it('clears the end-of-file offer immediately on a timeline seek and on a native rewind', async () => {
    const player = await mountPlayer();
    await player.emit('ended');
    expect(screen.getByRole('button', { name: /Choose source/i })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: /Playback position/i }), {
      target: { value: '30000' },
    });
    expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
    expect(native.seek).toHaveBeenLastCalledWith(30);
    await player.emit('time', { milliseconds: 120000 });
    await player.emit('ended');
    await player.emit('time', { milliseconds: 20000 });
    expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
  });

  it('waits for end-of-file when duration is unknown', async () => {
    const player = await mountPlayer();
    // mpv sends no duration while it has none; the player then holds 0, as media.ts defines.
    for (const duration of [0]) {
      await player.emit('duration', { milliseconds: duration });
      await player.emit('time', { milliseconds: 1_000_000 });
      expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
    }
    await player.emit('ended');
    expect(screen.getByRole('button', { name: /Choose source/i })).toBeInTheDocument();
    expect(player.onFinished).not.toHaveBeenCalled();
  });

  it.each([{ upNext: false }, { hasNextVideo: false }])(
    'respects availability and preference: %j',
    async (options) => {
      const player = await mountPlayer(options);
      await player.emit('time', { milliseconds: 115000 });
      await player.emit('ended');
      expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
      expect(player.onFinished).not.toHaveBeenCalled();
    },
  );
});
