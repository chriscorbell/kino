import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useFullscreen } from './useFullscreen';

const container = { current: document.createElement('div') };
let current: Element | null = null;
const enter = vi.fn();
const exit = vi.fn();

beforeEach(() => {
  current = null;
  enter.mockReset().mockResolvedValue(undefined);
  exit.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  container.current.requestFullscreen = enter;
});
afterEach(() => {
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
});

it('follows browser events and actual fullscreen state instead of assuming requests succeeded', () => {
  const { result } = renderHook(() => useFullscreen(container, null));
  act(() => result.current.toggle());
  expect(enter).toHaveBeenCalledOnce();
  expect(result.current.fullscreen).toBe(false);
  act(() => {
    current = container.current;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(result.current.fullscreen).toBe(true);
  act(() => result.current.toggle());
  expect(exit).toHaveBeenCalledOnce();
  act(() => {
    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(result.current.fullscreen).toBe(false);
});

it('handles rejected requests and allows a successful retry', async () => {
  enter.mockRejectedValueOnce(new TypeError('User activation required'));
  const { result } = renderHook(() => useFullscreen(container, null));
  act(() => result.current.toggle());
  await waitFor(() =>
    expect(result.current.error).toBe('Fullscreen could not be changed. Try again.'),
  );
  expect(result.current.fullscreen).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.error).toBeNull();
  expect(enter).toHaveBeenCalledTimes(2);
});

it('reports browser fullscreen errors and removes event listeners on unmount', () => {
  const remove = vi.spyOn(document, 'removeEventListener');
  const { result, unmount } = renderHook(() => useFullscreen(container, null));
  act(() => document.dispatchEvent(new Event('fullscreenerror')));
  expect(result.current.error).toBe('Fullscreen could not be changed. Try again.');
  unmount();
  expect(remove).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('fullscreenerror', expect.any(Function));
  remove.mockRestore();
});
