import { describe, expect, it } from 'vitest';

import { NamespacedStorage } from './storage';

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
