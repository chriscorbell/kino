import { describe, expect, it } from 'vitest';

import { NamespacedStorage, SecureProfileStorage, type SecureAuthStorage } from './storage';

function harness(initialSecret: string | null = null) {
  const values = new Map<string, string>();
  let secret = initialSecret;
  const secure: SecureAuthStorage = {
    read: async () => secret,
    remove: async () => {
      secret = null;
    },
    write: async (value) => {
      secret = value;
    },
  };
  const local = new NamespacedStorage(
    {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    },
    'account',
  );
  return {
    local,
    secret: () => secret,
    storage: new SecureProfileStorage(local, secure),
  };
}

const auth = { key: 'secret-token', user: { email: 'viewer@example.com' } };
const profile = { addons: [], auth, settings: { interfaceLanguage: 'eng' } };

describe('secure account profile storage', () => {
  it('keeps authentication material out of local storage and reconstructs the core profile', async () => {
    const { local, secret, storage } = harness();

    await storage.setItem('profile', JSON.stringify(profile));

    expect(JSON.parse(local.getItem('profile') ?? '{}').auth).toBeNull();
    expect(JSON.parse(secret() ?? '{}')).toEqual(auth);
    expect(JSON.parse((await storage.getItem('profile')) ?? '{}')).toEqual(profile);
  });

  it('migrates a legacy native profile without leaving its auth object in local storage', async () => {
    const { local, secret, storage } = harness();
    local.setItem('profile', JSON.stringify(profile));

    expect(JSON.parse((await storage.getItem('profile')) ?? '{}')).toEqual(profile);
    expect(JSON.parse(local.getItem('profile') ?? '{}').auth).toBeNull();
    expect(JSON.parse(secret() ?? '{}')).toEqual(auth);
  });

  it('removes secure authentication when the core signs out', async () => {
    const { local, secret, storage } = harness(JSON.stringify(auth));

    await storage.setItem('profile', JSON.stringify({ ...profile, auth: null }));

    expect(secret()).toBeNull();
    expect(JSON.parse(local.getItem('profile') ?? '{}').auth).toBeNull();
  });

  it('refuses to persist an invalid account profile in ordinary storage', async () => {
    const { local, storage } = harness();

    await expect(storage.setItem('profile', '{"auth":')).rejects.toThrow('invalid account profile');
    expect(local.getItem('profile')).toBeNull();
  });

  it('clears an orphaned secure session when its profile is gone', async () => {
    const { secret, storage } = harness(JSON.stringify(auth));

    expect(await storage.getItem('profile')).toBeNull();
    expect(secret()).toBeNull();
  });

  it('clears a corrupted secure session so the account can sign in again', async () => {
    const { local, secret, storage } = harness('not-json');
    local.setItem('profile', JSON.stringify({ ...profile, auth: null }));

    expect(await storage.getItem('profile')).toBeNull();
    expect(local.getItem('profile')).toBeNull();
    expect(secret()).toBeNull();
  });
});
