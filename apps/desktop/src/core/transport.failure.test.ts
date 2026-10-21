import { afterEach, expect, it, vi } from 'vitest';

import { video } from '../test/coreState';
import { markVideoWatchedAction, unloadAction } from './actions';
import { coreStopped } from './errors';
import { createCoreTransport } from './transport';

const state = vi.hoisted(() => ({
  worker: null as EventTarget | null,
  call: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock('./core.worker?worker', () => ({
  default: class extends EventTarget {
    constructor() {
      super();
      state.worker = this;
    }
    terminate = state.terminate;
  },
}));
vi.mock('@stremio/stremio-core-web/bridge.js', () => ({
  default: class {
    call = state.call;
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(['error', 'messageerror'])(
  'rejects outstanding and future RPCs after worker %s',
  async (event) => {
    state.call.mockImplementation(() => new Promise(() => {}));
    const transport = createCoreTransport();
    const result = Promise.allSettled([transport.init(), transport.getState('ctx')]);
    state.worker!.dispatchEvent(new Event(event));
    expect((await result).map((item) => item.status)).toEqual(['rejected', 'rejected']);
    await expect(transport.getState('ctx')).rejects.toThrow();
    expect(state.terminate).toHaveBeenCalledOnce();
    await transport.destroy().catch(() => {});
  },
);

it('bounds missing startup responses and allows teardown', async () => {
  vi.useFakeTimers();
  state.call.mockImplementation(() => new Promise(() => {}));
  const transport = createCoreTransport();
  const initialized = expect(transport.init()).rejects.toThrow(/respond|timed out/i);
  await vi.advanceTimersByTimeAsync(30_000);
  await initialized;
  await transport.destroy().catch(() => {});
  expect(state.terminate).toHaveBeenCalledOnce();
});

it('rejects an outstanding model read when a healthy worker is destroyed', async () => {
  state.call.mockImplementation(([method]: string[]) =>
    method === 'getState' ? new Promise(() => {}) : Promise.resolve(),
  );
  const transport = createCoreTransport();
  await transport.init();
  const read = expect(transport.getState('ctx')).rejects.toThrow();
  await transport.destroy();
  await read;
  await expect(transport.getState('ctx')).rejects.toThrow();
});

// The playback exit leaves instead of retrying once a save fails this way.
it('marks every call the dead worker fails as stopped, a save waiting on storage too', async () => {
  state.call.mockImplementation(([method]: string[]) =>
    method === 'flush' ? new Promise(() => {}) : Promise.resolve(),
  );
  const transport = createCoreTransport();
  const save = transport
    .commit(markVideoWatchedAction(video({ id: 'ep1' }), true))
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(state.call).toHaveBeenCalledWith(['flush'], []));
  state.worker!.dispatchEvent(new Event('error'));
  expect(coreStopped(await save)).toBe(true);
  expect(coreStopped(await transport.dispatch(unloadAction).catch((e) => e))).toBe(true);
  expect(coreStopped(new Error('Storage is full.'))).toBe(false);
});
