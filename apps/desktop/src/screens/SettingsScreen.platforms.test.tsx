import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { stubNativeShell } from '../test/nativeShell';

vi.mock('../core/context', () => ({ useCore: () => ({ transport: null }) }));
vi.mock('../core/useCoreModel', () => ({ useCoreModel: () => ({ state: null }) }));

// Each case needs a fresh native/player, which keeps the shell connection it made, so the screen
// and the settings provider it reads are imported fresh too.
beforeEach(() => {
  vi.resetModules();
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (X11; Linux x86_64) QtWebEngine/6.10.2',
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A shell whose bridge answers as Main.qml's nativeBridge does. */
const shell = (platform: string, capabilities: string[]) =>
  stubNativeShell({
    kinoNative: { platform, capabilities },
    kinoDiagnostics: { cacheBytes: async () => 0 },
  });

async function render() {
  const { SettingsScreen } = await import('./SettingsScreen');
  const { renderWithSettings } = await import('../test/renderWithSettings');
  renderWithSettings(<SettingsScreen />);
}

async function openSettings() {
  await render();
  await screen.findByRole('switch', { name: /Skip intro button/ });
  return {
    matchRefreshRate: screen.queryByRole('switch', { name: /Match refresh rate/ }),
    interfaceSize: screen.queryByRole('combobox', { name: /Interface size/ }),
    audioOutput: screen.queryByRole('combobox', { name: /Audio output/ }),
    subtitles: screen.queryByRole('switch', { name: /^Subtitles/ }),
  };
}

const bothCapabilities = ['interfaceScale', 'refreshRateMatching'];

it.each([
  ['macos', bothCapabilities],
  ['windows', bothCapabilities],
])('offers Match refresh rate in the %s shell, which can switch the display', async (...bridge) => {
  shell(...bridge);
  const settings = await openSettings();
  expect(settings.matchRefreshRate).toBeInTheDocument();
  expect(settings.interfaceSize).toBeInTheDocument();
  expect(settings.audioOutput).toBeInTheDocument();
  expect(settings.subtitles).toBeInTheDocument();
});

it('hides Match refresh rate in the Linux shell, which reports no refresh rate matching', async () => {
  shell('linux', ['interfaceScale']);
  const settings = await openSettings();
  expect(settings.matchRefreshRate).not.toBeInTheDocument();
  expect(settings.interfaceSize).toBeInTheDocument();
  expect(settings.audioOutput).toBeInTheDocument();
  expect(settings.subtitles).toBeInTheDocument();
});

it('hides Match refresh rate wherever the shell does not report the capability', async () => {
  shell('macos', ['interfaceScale']);
  expect((await openSettings()).matchRefreshRate).not.toBeInTheDocument();
});

it('offers no shell or native player setting in the web build, which has neither', async () => {
  const settings = await openSettings();
  expect(settings.matchRefreshRate).not.toBeInTheDocument();
  expect(settings.interfaceSize).not.toBeInTheDocument();
  expect(settings.audioOutput).not.toBeInTheDocument();
  expect(settings.subtitles).not.toBeInTheDocument();
});

it('says so in Settings when the shell names a platform the schema does not know', async () => {
  shell('freebsd', bothCapabilities);
  await render();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Native shell services are unavailable.',
  );
  expect(screen.queryByRole('switch', { name: /Match refresh rate/ })).not.toBeInTheDocument();
});
