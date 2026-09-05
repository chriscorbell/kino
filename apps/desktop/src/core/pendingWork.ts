// Core dispatch returns before its WASM futures finish. Track the work that
// must outlive navigation or shutdown, including the storage bridge reply.
export class PendingCoreWork {
  readonly #pending = new Set<Promise<void>>();
  #storageFailed = false;

  track<Value>(operation: Promise<Value>, required = true): Promise<Value> {
    const settled = operation.then(
      () => undefined,
      () => {
        if (required) this.#storageFailed = true;
      },
    );
    this.#pending.add(settled);
    void settled.then(() => this.#pending.delete(settled));
    return operation;
  }

  async flush(timeoutMs = 10000): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Core storage did not finish in time.')),
        timeoutMs,
      );
    });
    try {
      for (;;) {
        // spawn_local schedules WASM futures in microtasks. Give all resulting
        // storage calls a chance to enter the set before declaring it drained.
        await Promise.race([new Promise((resolve) => setTimeout(resolve, 0)), expired]);
        if (this.#pending.size === 0) break;
        await Promise.race([Promise.all(this.#pending), expired]);
      }
      if (this.#storageFailed) {
        this.#storageFailed = false;
        throw new Error('Core could not save data on this device.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function trackCoreSync(fetchRequest: typeof fetch, work: PendingCoreWork): typeof fetch {
  return (input, init) => {
    const response = fetchRequest(input, init);
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      globalThis.location?.href,
    );
    if (url.pathname.endsWith('/datastorePut')) {
      // Core consumes response.text() before processing the sync result. Wait
      // for the body too; receiving HTTP headers does not complete the write.
      void work
        .track(
          response.then(async (value) => {
            await value.clone().arrayBuffer();
          }),
          false,
        )
        .catch(() => undefined);
    }
    return response;
  };
}
