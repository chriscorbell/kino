import { afterEach, describe, expect, it, vi } from 'vitest';

import { t as enUS } from '../locales';
import type { NativePlayer } from '../native/player';
import { mediaFailureMessage } from './failures';
import type { MediaEvent } from './media';
import { mpvBackend, parseNativeEvent } from './mpvBackend';

afterEach(() => vi.restoreAllMocks());

describe('parseNativeEvent', () => {
  // Payloads shaped as apps/macos-shell/src/mpvitem.cpp emits them.
  it.each<[string, Record<string, unknown>, MediaEvent]>([
    ['time', { milliseconds: 34567 }, { type: 'time', milliseconds: 34567 }],
    ['duration', { milliseconds: 120000 }, { type: 'duration', milliseconds: 120000 }],
    ['buffered', { milliseconds: 150000 }, { type: 'buffered', milliseconds: 150000 }],
    ['paused', { paused: true }, { type: 'paused', paused: true }],
    ['buffering', { active: false }, { type: 'buffering', active: false }],
    ['ready', {}, { type: 'ready' }],
    ['ended', {}, { type: 'ended' }],
    ['volume', { percent: 65 }, { type: 'volume', percent: 65 }],
    ['volume', { percent: 130 }, { type: 'volume', percent: 100 }],
    ['muted', { muted: true }, { type: 'muted', muted: true }],
    [
      'audioTracks',
      { items: [{ id: 2, lang: 'spa', codec: 'aac', selected: true }, { id: 0 }] },
      { type: 'audioTracks', tracks: [{ id: 2, lang: 'spa', codec: 'aac', selected: true }] },
    ],
    [
      'subtitleTracks',
      { items: [{ id: 3, lang: 'eng', external: true, title: 'token' }, 'broken'] },
      {
        type: 'subtitleTracks',
        tracks: [{ id: 3, lang: 'eng', external: true, selected: false, title: 'token' }],
      },
    ],
    [
      'chapters',
      {
        items: [
          { startMs: 60000, title: 'Opening' },
          { startMs: 'soon', title: 'Bad' },
        ],
      },
      { type: 'chapters', cues: [{ startMs: 60000, title: 'Opening' }] },
    ],
    [
      'error',
      { code: 'decoder-or-stream-failed' },
      {
        type: 'failed',
        failure: 'native-playback-failed',
        detail: { code: 'decoder-or-stream-failed' },
      },
    ],
  ])('reads %s', (name, payload, event) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseNativeEvent(name, payload)).toEqual(event);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['hardwareDecoding', 'refreshRate'])('leaves the probe-only %s event alone', (name) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseNativeEvent(name, { active: true, hz: 120 })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['time', { milliseconds: 'Secret Title' }],
    ['duration', { seconds: 120 }],
    ['buffered', { milliseconds: Number.NaN }],
    ['paused', { paused: 'Secret Title' }],
    ['buffering', {}],
    ['volume', { percent: Number.POSITIVE_INFINITY }],
    ['muted', { muted: 1 }],
    ['seeked', { title: 'Secret Title' }],
  ])('drops an unreadable %s event and logs only its name', (name, payload) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseNativeEvent(name, payload)).toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith('[kino:player] unreadable native event', name);
  });

  it.each<[string, Record<string, unknown>, MediaEvent]>([
    ['audioTracks', { items: 'Secret Title' }, { type: 'audioTracks', tracks: [] }],
    ['subtitleTracks', { tracks: [] }, { type: 'subtitleTracks', tracks: [] }],
    ['chapters', { items: { title: 'Secret Title' } }, { type: 'chapters', cues: [] }],
    [
      'error',
      { message: 'Secret Title' },
      { type: 'failed', failure: 'native-playback-failed', detail: { code: 'unknown' } },
    ],
  ])('still acts on an unreadable %s event and logs only its name', (name, payload, event) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseNativeEvent(name, payload)).toEqual(event);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[kino:player] unreadable native event', name);
  });

  it('names why the native player refused a source', () => {
    const message = (code: string) => {
      const event = parseNativeEvent('error', { code });
      return event?.type === 'failed' ? mediaFailureMessage(event.failure) : null;
    };
    expect(message('dolby-vision-unsupported')).toBe(enUS.player.dolbyVisionUnsupported);
    expect(message('hardware-decoding-unavailable')).toBe(enUS.player.hardwareDecodingFailed);
    expect(message('render-context-unavailable')).toBe(enUS.player.rendererFailed);
    expect(message('player-unavailable')).toBe(enUS.player.playerUnavailable);
    expect(message('something-new')).toBe(enUS.player.nativePlaybackFailed);
  });
});

function fakeShell() {
  return {
    load: vi.fn(),
    loadWithAudioLanguage: vi.fn(),
    setMatchFrameRate: vi.fn(),
    seek: vi.fn(),
    setSubtitleTrack: vi.fn(),
    setSubtitleDelay: vi.fn(),
    pauseAndSnapshot: vi.fn<() => Promise<{ time: number; duration: number }>>(),
    playerEvent: {
      connect:
        vi.fn<(listener: (name: string, payload: Record<string, unknown>) => void) => void>(),
      disconnect: vi.fn(),
    },
  };
}

const backendFor = (shell: object) => mpvBackend(shell as unknown as NativePlayer);

const request = {
  url: 'https://media.invalid/fixture.mkv',
  headers: { Referer: 'https://required.invalid/' },
  stereo: true,
  audioLanguage: 'spa',
  matchRefreshRate: true,
};

describe('mpvBackend', () => {
  it('sends the refresh-rate preference before the source it applies to', () => {
    const native = fakeShell();
    backendFor(native).load(request);
    expect(native.setMatchFrameRate).toHaveBeenCalledExactlyOnceWith(true);
    expect(native.loadWithAudioLanguage).toHaveBeenCalledExactlyOnceWith(
      request.url,
      true,
      request.headers,
      'spa',
    );
    expect(native.setMatchFrameRate.mock.invocationCallOrder[0]).toBeLessThan(
      native.loadWithAudioLanguage.mock.invocationCallOrder[0]!,
    );
  });

  it('loads through an older shell without audio languages or refresh-rate matching', () => {
    const native = {
      ...fakeShell(),
      loadWithAudioLanguage: undefined,
      setMatchFrameRate: undefined,
    };
    backendFor(native).load(request);
    expect(native.load).toHaveBeenCalledExactlyOnceWith(request.url, true, request.headers);
  });

  it("converts Kino's units to the shell's", () => {
    const native = fakeShell();
    const backend = backendFor(native);
    backend.seek(90_500);
    backend.setSubtitleTrack(null);
    backend.setSubtitleDelay(-1_500);
    expect(native.seek).toHaveBeenCalledExactlyOnceWith(90.5);
    expect(native.setSubtitleTrack).toHaveBeenCalledExactlyOnceWith(0);
    expect(native.setSubtitleDelay).toHaveBeenCalledExactlyOnceWith(-1.5);
  });

  it('delivers parsed events to subscribers until they leave', () => {
    const native = fakeShell();
    const events: MediaEvent[] = [];
    const leave = backendFor(native).subscribe((event) => events.push(event));
    const listener = native.playerEvent.connect.mock.calls[0]![0];
    listener('time', { milliseconds: 1000 });
    listener('hardwareDecoding', { active: true });
    expect(events).toEqual([{ type: 'time', milliseconds: 1000 }]);
    leave();
    expect(native.playerEvent.disconnect).toHaveBeenCalledExactlyOnceWith(listener);
  });

  it('logs an unreadable event once per subscription, however often it arrives', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const native = fakeShell();
    const backend = backendFor(native);
    backend.subscribe(() => {});
    const listener = native.playerEvent.connect.mock.calls[0]![0];
    for (let frame = 0; frame < 60; frame++) listener('time', { seconds: frame / 24 });
    listener('paused', {});
    expect(warn.mock.calls).toEqual([
      ['[kino:player] unreadable native event', 'time'],
      ['[kino:player] unreadable native event', 'paused'],
    ]);
    backend.subscribe(() => {});
    native.playerEvent.connect.mock.calls[1]![0]('time', { seconds: 3 });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('freezes on a position Core can store, or none', async () => {
    const native = fakeShell();
    const backend = backendFor(native);
    native.pauseAndSnapshot.mockResolvedValueOnce({ time: 34567, duration: 120000 });
    await expect(backend.freeze()).resolves.toEqual({ time: 34567, duration: 120000 });
    native.pauseAndSnapshot.mockResolvedValueOnce({ time: 0, duration: 0 });
    await expect(backend.freeze()).resolves.toBeNull();
  });
});
