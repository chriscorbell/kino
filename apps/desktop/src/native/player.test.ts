import { afterEach, expect, it, vi } from 'vitest';

import { playbackDevice, refreshMatchingAvailable } from './player';

const agents = {
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) QtWebEngine/6.11.2',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) QtWebEngine/6.10.2',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QtWebEngine/6.10.3',
};

function shell(agent: string, native = true) {
  vi.stubGlobal('navigator', { ...navigator, userAgent: agent });
  vi.stubGlobal('qt', native ? { webChannelTransport: {} } : undefined);
}

afterEach(() => vi.unstubAllGlobals());

it('names the shell system with playback progress, and the web outside it', () => {
  shell(agents.macos);
  expect(playbackDevice()).toBe('kino-macos');
  shell(agents.linux);
  expect(playbackDevice()).toBe('kino-linux');
  shell(agents.windows);
  expect(playbackDevice()).toBe('kino-windows');
  shell(agents.macos, false);
  expect(playbackDevice()).toBe('kino-web');
});

it('offers refresh matching in the macOS and Windows shells only', () => {
  shell(agents.macos);
  expect(refreshMatchingAvailable()).toBe(true);
  shell(agents.windows);
  expect(refreshMatchingAvailable()).toBe(true);
  shell(agents.linux);
  expect(refreshMatchingAvailable()).toBe(false);
  shell(agents.macos, false);
  expect(refreshMatchingAvailable()).toBe(false);
});
