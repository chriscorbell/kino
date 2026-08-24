interface KeyValueStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export type CoreSession = 'account' | 'guest';

export class NamespacedStorage implements KeyValueStorage {
  readonly #prefix: string;
  readonly #storage: KeyValueStorage;

  constructor(storage: KeyValueStorage, session: CoreSession) {
    this.#storage = storage;
    this.#prefix = `kino.core.v1.${session}.`;
  }

  getItem(key: string) {
    return this.#storage.getItem(this.#prefix + key);
  }

  removeItem(key: string) {
    this.#storage.removeItem(this.#prefix + key);
  }

  setItem(key: string, value: string) {
    this.#storage.setItem(this.#prefix + key, value);
  }
}
