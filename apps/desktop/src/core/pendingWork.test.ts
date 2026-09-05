import { describe, expect, it } from 'vitest';

import { PendingCoreWork, trackCoreSync } from './pendingWork';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('Core persistence barrier', () => {
  it('waits for work spawned after dispatch and after a previous write', async () => {
    const work = new PendingCoreWork();
    const first = deferred();
    const second = deferred();
    let done = false;
    void Promise.resolve().then(() =>
      work.track(first.promise).then(() => work.track(second.promise)),
    );
    const flushing = work.flush().then(() => {
      done = true;
    });
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    second.resolve();
    await flushing;
    expect(done).toBe(true);
  });

  it('reports storage failure and permits a later successful retry', async () => {
    const work = new PendingCoreWork();
    void work.track(Promise.reject(new Error('quota'))).catch(() => undefined);
    await expect(work.flush()).rejects.toThrow('could not save');
    await work.track(Promise.resolve());
    await expect(work.flush()).resolves.toBeUndefined();
  });

  it('bounds a stalled write without pretending it completed', async () => {
    const work = new PendingCoreWork();
    const stalled = deferred();
    void work.track(stalled.promise);
    await expect(work.flush(10)).rejects.toThrow('did not finish');
    stalled.resolve();
    await expect(work.flush()).resolves.toBeUndefined();
  });

  it('allows shutdown after failed account sync once local persistence finishes', async () => {
    const work = new PendingCoreWork();
    const fetchRequest: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    await expect(
      trackCoreSync(fetchRequest, work)('https://api.strem.io/api/datastorePut'),
    ).rejects.toThrow('offline');
    await expect(work.flush()).resolves.toBeUndefined();
  });
});
