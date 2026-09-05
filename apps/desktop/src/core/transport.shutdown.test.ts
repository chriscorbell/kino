import { expect, it, vi } from 'vitest';

import { createCoreTransport } from './transport';

const worker = vi.hoisted(() => ({ terminate: vi.fn(), call: vi.fn() }));
vi.mock('./core.worker?worker', () => ({
  default: class {
    terminate = worker.terminate;
  },
}));
vi.mock('@stremio/stremio-core-web/bridge.js', () => ({
  default: class {
    call = worker.call;
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

it('retains the worker through startup, final player save, and the storage acknowledgement', async () => {
  const initialized = deferred();
  const saved = deferred();
  const drained = deferred();
  worker.terminate.mockClear();
  worker.call.mockImplementation(async ([method]: string[]) => {
    if (method === 'init') await initialized.promise;
    if (method === 'flush') await drained.promise;
  });
  const transport = createCoreTransport();
  const init = transport.init();
  const save = vi.fn(() => saved.promise);
  transport.onBeforeDestroy(save);
  const destroying = transport.destroy();
  expect(transport.destroy()).toBe(destroying);
  expect(save).not.toHaveBeenCalled();
  initialized.resolve();
  await init;
  await Promise.resolve();
  expect(save).toHaveBeenCalledOnce();
  expect(worker.terminate).not.toHaveBeenCalled();
  saved.resolve();
  await Promise.resolve();
  expect(worker.terminate).not.toHaveBeenCalled();
  drained.resolve();
  await destroying;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
