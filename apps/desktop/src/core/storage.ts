interface KeyValueStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface SecureAuthStorage {
  read(): Promise<string | null>;
  remove(): Promise<void>;
  write(value: string): Promise<void>;
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

function jsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class SecureProfileStorage {
  readonly #local: NamespacedStorage;
  readonly #secure: SecureAuthStorage;

  constructor(local: NamespacedStorage, secure: SecureAuthStorage) {
    this.#local = local;
    this.#secure = secure;
  }

  async getItem(key: string) {
    const localValue = this.#local.getItem(key);
    if (key !== 'profile') return localValue;
    if (!localValue) {
      await this.#secure.remove();
      return null;
    }

    const profile = jsonObject(localValue);
    if (!profile) {
      await this.#secure.remove();
      this.#local.removeItem(key);
      return null;
    }

    const localAuth = profile.auth;
    const secureValue = await this.#secure.read();
    if (secureValue) {
      const secureAuth = jsonObject(secureValue);
      if (!secureAuth) {
        await this.#secure.remove();
        this.#local.removeItem(key);
        return null;
      }
      if (localAuth !== null) {
        profile.auth = null;
        this.#local.setItem(key, JSON.stringify(profile));
      }
      profile.auth = secureAuth;
      return JSON.stringify(profile);
    }

    if (localAuth && typeof localAuth === 'object' && !Array.isArray(localAuth)) {
      try {
        await this.#secure.write(JSON.stringify(localAuth));
      } catch (error) {
        this.#local.removeItem(key);
        throw error;
      }
      profile.auth = null;
      this.#local.setItem(key, JSON.stringify(profile));
      profile.auth = localAuth;
      return JSON.stringify(profile);
    }

    if (localAuth !== null && localAuth !== undefined) {
      this.#local.removeItem(key);
      throw new Error('The stored Stremio session is invalid.');
    }

    return localValue;
  }

  async removeItem(key: string) {
    if (key === 'profile') await this.#secure.remove();
    this.#local.removeItem(key);
  }

  async setItem(key: string, value: string) {
    if (key !== 'profile') {
      this.#local.setItem(key, value);
      return;
    }

    const profile = jsonObject(value);
    if (!profile || !('auth' in profile)) {
      throw new Error('Stremio Core returned an invalid account profile.');
    }

    const auth = profile.auth;
    if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
      await this.#secure.write(JSON.stringify(auth));
    } else if (auth === null) {
      await this.#secure.remove();
    } else {
      throw new Error('Stremio Core returned an invalid account profile.');
    }
    profile.auth = null;
    this.#local.setItem(key, JSON.stringify(profile));
  }
}
