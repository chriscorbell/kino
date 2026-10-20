import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { InterfaceScale } from '../settings';
import { stubNativeShell } from '../test/nativeShell';

// native/player keeps the shell connection it makes, so each case imports the hooks fresh.
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

/** A Linux shell whose interface starts at 100% and takes any scale the client sends. */
function shell(capabilities: string[]) {
  const applied = { scale: 100 };
  stubNativeShell({
    kinoNative: { platform: 'linux', capabilities },
    kinoInterface: {
      setScale: async (percent: number) => {
        applied.scale = percent;
        return true;
      },
    },
  });
  return applied;
}

async function chooseScale(scale: InterfaceScale) {
  const { useInterfaceScale } = await import('./useInterfaceScale');
  const { useShellReport } = await import('./useShellReport');
  const { result } = renderHook(() => ({
    interfaceScale: useInterfaceScale(scale),
    report: useShellReport(),
  }));
  await waitFor(() => expect(result.current.report).not.toBeNull());
  // The fake shell answers without timers, so one timer turn lets any scale request finish.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return result.current.interfaceScale;
}

it('applies the chosen scale where the shell reports the interfaceScale capability', async () => {
  const applied = shell(['interfaceScale']);
  await chooseScale(150);
  expect(applied.scale).toBe(150);
});

it('offers Retry after a failed first handshake, and applies the scale once the shell answers', async () => {
  stubNativeShell({});
  const { useInterfaceScale } = await import('./useInterfaceScale');
  const { result, rerender } = renderHook((scale: InterfaceScale) => useInterfaceScale(scale), {
    initialProps: 150,
  });
  await waitFor(() => expect(result.current.failed).toBe(true));

  const applied = shell(['interfaceScale']);
  act(() => result.current.retry());
  await waitFor(() => expect(applied.scale).toBe(150));
  expect(result.current.failed).toBe(false);

  rerender(175);
  await waitFor(() => expect(applied.scale).toBe(175));
});

it('leaves the interface at 100% where the shell reports no interfaceScale capability', async () => {
  const applied = shell(['refreshRateMatching']);
  const interfaceScale = await chooseScale(150);
  expect(applied.scale).toBe(100);
  expect(interfaceScale.failed).toBe(false);
});
