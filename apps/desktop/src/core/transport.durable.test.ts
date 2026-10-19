import { afterEach, expect, it, vi } from 'vitest';

import { logoutAction } from './actions';
import { createCoreTransport } from './transport';

const state = vi.hoisted(() => ({ call: vi.fn(), terminate: vi.fn() }));
vi.mock('./core.worker?worker', () => ({
  default: class extends EventTarget {
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

it('resolves a commit only after Core has stored it', async () => {
  let store = () => {};
  state.call.mockImplementation(([method]: string[]) =>
    method === 'flush' ? new Promise<void>((resolve) => (store = resolve)) : Promise.resolve(),
  );
  const transport = createCoreTransport();
  let committed = false;
  const commit = transport.commit(logoutAction, 'ctx').then(() => {
    committed = true;
  });
  await vi.waitFor(() =>
    expect(state.call.mock.calls).toEqual([
      [['dispatch'], [logoutAction, 'ctx', '']],
      [['flush'], []],
    ]),
  );
  await Promise.resolve();
  expect(committed).toBe(false);
  store();
  await commit;
  expect(committed).toBe(true);
});

it('rejects a commit Core cannot store in time without ending the session', async () => {
  vi.useFakeTimers();
  const onFailure = vi.fn();
  state.call.mockImplementation(([method]: string[]) =>
    method === 'flush' ? new Promise(() => {}) : Promise.resolve({}),
  );
  const transport = createCoreTransport('guest', onFailure);
  await transport.init();
  const committed = expect(transport.commit(logoutAction)).rejects.toThrow(
    'Core storage did not finish in time.',
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await committed;
  expect(onFailure).not.toHaveBeenCalled();
  expect(state.terminate).not.toHaveBeenCalled();
  await expect(transport.getState('ctx')).resolves.toEqual({});
});
