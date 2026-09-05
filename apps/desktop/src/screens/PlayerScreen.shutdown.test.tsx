import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const native = vi.hoisted(() => {
  const listeners = new Set<(name: string, payload: Record<string, unknown>) => void>();
  return {
    listeners,
    load: vi.fn(),
    stop: vi.fn(),
    pauseAndSnapshot: vi.fn(),
    setVolume: vi.fn(),
    setSubtitleScale: vi.fn(),
    setSubtitlePosition: vi.fn(),
    setNowPlayingMetadata: vi.fn(),
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    playerEvent: {
      connect: (listener: (name: string, payload: Record<string, unknown>) => void) =>
        listeners.add(listener),
      disconnect: (listener: (name: string, payload: Record<string, unknown>) => void) =>
        listeners.delete(listener),
    },
  };
});
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  connectNativePlayer: async () => native,
}));

beforeEach(() => {
  native.listeners.clear();
  native.load.mockClear();
  native.stop.mockClear();
  native.pauseAndSnapshot.mockResolvedValue({ time: 0, duration: 0 });
});

async function mountPlayer() {
  const calls: string[] = [];
  const closing = new Set<() => Promise<void>>();
  let holdFlush = false;
  let finishFlush!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishFlush = resolve;
  });
  const transport = {
    init: vi.fn(),
    destroy: vi.fn(),
    dispatch: vi.fn(async (action: { action: string; args?: unknown }) => {
      const args = action.args as { action?: string; args?: { time?: number } } | undefined;
      calls.push(
        action.action === 'Player' ? `${args?.action}:${args?.args?.time ?? ''}` : action.action,
      );
    }),
    getState: async <State,>() =>
      ({ selected: { stream }, stream: { type: 'Ready', content: stream } }) as State,
    subscribe: () => () => {},
    onBeforeDestroy: (callback: () => Promise<void>) => {
      closing.add(callback);
      return () => closing.delete(callback);
    },
    prepareClose: async () => {
      await Promise.all([...closing].map((callback) => callback()));
    },
    flush: vi.fn(async () => {
      calls.push('flush');
      if (holdFlush) await pending;
      calls.push('saved');
    }),
  };
  const stream = { url: 'https://media.invalid/fixture.mp4', deepLinks: { player: '' } };
  const onBack = vi.fn();
  const onSourceFailure = vi.fn();
  const onUpNext = vi.fn();
  const nextVideo = { id: 'ep2', title: 'Episode two', season: 1, episode: 2 };
  const view = render(
    <StrictMode>
      <CoreContext.Provider
        value={{
          error: null,
          status: 'ready',
          session: 'guest',
          transport,
          selectSession: vi.fn(),
        }}
      >
        <PlayerScreen
          selection={{
            meta: {
              id: 'show',
              name: 'Test series',
              type: 'series',
              inLibrary: false,
              watched: false,
            },
            stream,
            streamTransportUrl: 'https://addon.invalid/manifest.json',
            metaTransportUrl: 'https://addon.invalid/manifest.json',
            video: { id: 'ep1', title: 'Episode one', season: 1, episode: 1 },
            nextVideo,
          }}
          settings={defaultSettings}
          preferredSubtitleLanguage={null}
          onBack={onBack}
          onSourceFailure={onSourceFailure}
          onUpNext={onUpNext}
          onSettingsChange={vi.fn()}
        />
      </CoreContext.Provider>
    </StrictMode>,
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  const emit = async (name: string, payload: Record<string, unknown> = {}) => {
    await act(async () => {
      native.listeners.forEach((listener) => listener(name, payload));
    });
  };
  await emit('duration', { milliseconds: 120000 });
  await emit('time', { milliseconds: 30000 });
  await emit('time', { milliseconds: 34567 });
  native.pauseAndSnapshot.mockResolvedValue({ time: 34567, duration: 120000 });
  calls.length = 0;
  holdFlush = true;
  return {
    calls,
    closing,
    emit,
    finishFlush,
    nextVideo,
    onBack,
    onSourceFailure,
    onUpNext,
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
    expect(player.onBack).not.toHaveBeenCalled();
    expect(player.calls).not.toContain('Unload');
    expect(native.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await act(async () => player.finishFlush());
    await waitFor(() => expect(player.onBack).toHaveBeenCalledOnce());
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
    expect(player.onBack).toHaveBeenCalledOnce();
  });

  it.each(['Back', 'failure', 'Up Next', 'native close', 'unmount'] as const)(
    'saves the latest position before unload on %s',
    async (exit) => {
      const player = await mountPlayer();
      let closing: Promise<void> | undefined;
      if (exit === 'Back') fireEvent.click(screen.getByRole('button', { name: /Back/ }));
      if (exit === 'failure') await player.emit('error', { code: 'decoder-or-stream-failed' });
      if (exit === 'Up Next') {
        await player.emit('ended');
        fireEvent.click(screen.getByRole('button', { name: /Choose source/i }));
      }
      if (exit === 'native close') {
        expect(player.closing.size).toBe(1);
        closing = player.transport.prepareClose();
      }
      if (exit === 'unmount') player.view.unmount();
      await waitFor(() => expect(player.calls).toContain('TimeChanged:34567'));
      expect(player.calls).not.toContain('Unload');
      expect(player.onBack).not.toHaveBeenCalled();
      expect(player.onSourceFailure).not.toHaveBeenCalled();
      expect(player.onUpNext).not.toHaveBeenCalled();
      await act(async () => {
        player.finishFlush();
        await closing;
      });
      await waitFor(() => expect(player.calls).toContain('Unload'));
      expect(player.calls.indexOf('TimeChanged:34567')).toBeLessThan(player.calls.indexOf('saved'));
      expect(player.calls.indexOf('saved')).toBeLessThan(player.calls.indexOf('Unload'));
      expect(player.calls.filter((call) => call === 'Unload')).toHaveLength(1);
      if (exit === 'Back') expect(player.onBack).toHaveBeenCalledOnce();
      if (exit === 'failure') expect(player.onSourceFailure).toHaveBeenCalledOnce();
      if (exit === 'Up Next')
        expect(player.onUpNext).toHaveBeenCalledExactlyOnceWith(player.nextVideo);
    },
  );
});
