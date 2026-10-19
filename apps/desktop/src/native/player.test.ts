import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { playbackDevice } from '../playback/progress';
import { stubNativeShell } from '../test/nativeShell';

const player = {
  load: vi.fn(),
  startStreamingEngine: vi.fn(),
  setMatchFrameRate: vi.fn(),
};

// The shell connection is kept for the module's life, so each case imports a fresh one.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QtWebEngine/6.10.3',
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shell = (bridge: Record<string, unknown>) =>
  stubNativeShell({ kinoNative: { ...player, ...bridge } });

const connect = async () => (await import('./player')).connectShellReport();

it('reads the platform and capabilities from the bridge, not the user agent, starting nothing', async () => {
  shell({ platform: 'linux', capabilities: ['interfaceScale', 'somethingNew'] });
  const report = await connect();
  expect(report.platform).toBe('linux');
  expect([...report.capabilities]).toEqual(['interfaceScale']);
  expect(player.load).not.toHaveBeenCalled();
  expect(player.startStreamingEngine).not.toHaveBeenCalled();
  expect(player.setMatchFrameRate).not.toHaveBeenCalled();
});

it.each([
  { platform: 'freebsd', capabilities: [] },
  { capabilities: [] },
  { platform: 'macos', capabilities: 'refreshRateMatching' },
  { platform: 'macos' },
])('refuses a bridge that does not report a known platform and a list', async (bridge) => {
  shell(bridge);
  await expect(connect()).rejects.toThrow();
});

it('knows the report once the shell has answered, and the web build at once', async () => {
  shell({ platform: 'windows', capabilities: ['refreshRateMatching'] });
  const { connectShellReport, knownShellReport } = await import('./player');
  expect(knownShellReport()).toBeNull();
  await connectShellReport();
  expect(knownShellReport()?.platform).toBe('windows');
  vi.stubGlobal('qt', undefined);
  expect(knownShellReport()?.platform).toBe('web');
});

it('names the shell platform with playback progress, and the web outside it', async () => {
  shell({ platform: 'macos', capabilities: [] });
  expect(playbackDevice((await connect()).platform)).toBe('kino-macos');
  vi.resetModules();
  vi.stubGlobal('qt', undefined);
  expect(playbackDevice((await connect()).platform)).toBe('kino-web');
});
