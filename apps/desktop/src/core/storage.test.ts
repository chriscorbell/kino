import { describe, expect, it } from 'vitest';

import { loadSession, NamespacedStorage, saveSession } from './storage';

describe('core session storage', () => {
  it('keeps guest and account data isolated under the same logical key', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const guest = new NamespacedStorage(storage, 'guest');
    const account = new NamespacedStorage(storage, 'account');

    guest.setItem('profile', 'guest-profile');
    account.setItem('profile', 'account-profile');

    expect(guest.getItem('profile')).toBe('guest-profile');
    expect(account.getItem('profile')).toBe('account-profile');

    guest.removeItem('profile');

    expect(guest.getItem('profile')).toBeNull();
    expect(account.getItem('profile')).toBe('account-profile');
  });
});

describe('session persistence', () => {
  it('restores the account session so sign-in survives a restart', () => {
    expect(loadSession({ getItem: () => 'account' })).toBe('account');
  });

  it('falls back to guest for missing, unknown, or unreadable values', () => {
    expect(loadSession({ getItem: () => null })).toBe('guest');
    expect(loadSession({ getItem: () => 'nonsense' })).toBe('guest');
    expect(
      loadSession({
        getItem: () => {
          throw new Error('unavailable');
        },
      }),
    ).toBe('guest');
  });

  it('writes the selected session', () => {
    let stored: string | null = null;
    saveSession({ setItem: (_key, value) => (stored = value) }, 'account');
    expect(stored).toBe('account');
  });
});
