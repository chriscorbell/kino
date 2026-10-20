import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type { NativePlayer } from '../native/player';

/**
 * A Qt signal as the WebChannel exposes it. `emit` delivers to every connected
 * listener inside `act`; `fire` does the same inside an `act` the test already holds.
 */
function signal<Args extends unknown[]>() {
  type Listener = (...args: Args) => void;
  const listeners = new Set<Listener>();
  const fire = (...args: Args) => listeners.forEach((listener) => listener(...args));
  return {
    connect: vi.fn<(listener: Listener) => void>((listener) => void listeners.add(listener)),
    disconnect: vi.fn<(listener: Listener) => void>((listener) => void listeners.delete(listener)),
    fire,
    emit: (...args: Args) => act(async () => fire(...args)),
  };
}

/**
 * The shell's `kinoNative` object, with every method a mock. `extra` adds the
 * optional methods a newer shell has, such as `loadWithAudioLanguage`, whose
 * presence changes how the client loads.
 */
export function fakeNativePlayer<Extra extends Partial<NativePlayer>>(extra = {} as Extra) {
  const playerEvent = signal<[name: string, payload: Record<string, unknown>]>();
  const player = {
    fullscreen: false,
    fullscreenChanged: signal<[]>(),
    playerEvent,
    streamingEngineChanged: signal<[url: string, error: string]>(),
    platform: 'macos',
    capabilities: [],
    shellVersion: '0.0.0',
    openAccountCreation: vi.fn<NativePlayer['openAccountCreation']>(async () => true),
    addSubtitles: vi.fn<NativePlayer['addSubtitles']>(),
    load: vi.fn<NativePlayer['load']>(),
    pauseAndSnapshot: vi.fn<NativePlayer['pauseAndSnapshot']>(async () => ({
      time: 0,
      duration: 0,
    })),
    seek: vi.fn<NativePlayer['seek']>(),
    setAudioTrack: vi.fn<NativePlayer['setAudioTrack']>(),
    setFullscreen: vi.fn<NativePlayer['setFullscreen']>(),
    setMuted: vi.fn<NativePlayer['setMuted']>(),
    setNowPlayingMetadata: vi.fn<NativePlayer['setNowPlayingMetadata']>(),
    setPaused: vi.fn<NativePlayer['setPaused']>(),
    setSubtitleDelay: vi.fn<NativePlayer['setSubtitleDelay']>(),
    setSubtitlePosition: vi.fn<NativePlayer['setSubtitlePosition']>(),
    setSubtitleScale: vi.fn<NativePlayer['setSubtitleScale']>(),
    setSubtitleTrack: vi.fn<NativePlayer['setSubtitleTrack']>(),
    setVolume: vi.fn<NativePlayer['setVolume']>(),
    startStreamingEngine: vi.fn<NativePlayer['startStreamingEngine']>(),
    stop: vi.fn<NativePlayer['stop']>(),
    emit: (name: string, payload: Record<string, unknown> = {}) => playerEvent.emit(name, payload),
    ...extra,
  };
  return player satisfies NativePlayer;
}
