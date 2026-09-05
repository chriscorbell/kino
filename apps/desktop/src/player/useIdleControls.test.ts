import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useIdleControls } from './useIdleControls';

const topbar = { current: document.createElement('div') };
const controls = { current: document.createElement('div') };
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('hides after inactivity and restarts the full delay for pointer, keyboard, and focus activity', () => {
  const { result, unmount } = renderHook(() => useIdleControls(topbar, controls, false));
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(false);
  for (const event of ['pointermove', 'keydown', 'focusin']) {
    act(() => window.dispatchEvent(new Event(event)));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  }
  act(() => window.dispatchEvent(new Event('pointermove')));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('stays visible when pinned and starts a fresh delay when playback can hide again', () => {
  const { result, rerender } = renderHook(
    ({ pinned }) => useIdleControls(topbar, controls, pinned),
    { initialProps: { pinned: false } },
  );
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(false);
  rerender({ pinned: true });
  act(() => vi.advanceTimersByTime(9000));
  expect(result.current).toBe(true);
  rerender({ pinned: false });
  act(() => vi.advanceTimersByTime(2999));
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(false);
});

it('keeps hovered controls visible until the pointer leaves and becomes idle', () => {
  const hover = vi.spyOn(controls.current, 'matches').mockReturnValue(true);
  const { result } = renderHook(() => useIdleControls(topbar, controls, false));
  act(() => vi.advanceTimersByTime(9000));
  expect(result.current).toBe(true);
  hover.mockReturnValue(false);
  act(() => window.dispatchEvent(new Event('pointerleave')));
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(false);
});
