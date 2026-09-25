import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreRuntimeEvent } from '../core/types';
import { AccountDialog } from './AccountDialog';

const created = vi.hoisted(() => [] as ReturnType<typeof fakeTransport>[]);
vi.mock('../core/transport', () => ({
  createCoreTransport: vi.fn(() => {
    const transport = fakeTransport();
    created.push(transport);
    return transport;
  }),
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => false,
  openAccountCreation: vi.fn(),
}));

function fakeTransport() {
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const calls: string[] = [];
  const transport = {
    calls,
    emit: (event: CoreRuntimeEvent) => listeners.forEach((listener) => listener(event)),
    destroy: vi.fn(async () => {
      calls.push('destroy');
    }),
    dispatch: vi.fn(async (action: { args?: { action?: string } }) => {
      calls.push(`dispatch:${action.args?.action ?? ''}`);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(async () => ({ profile: { auth: null } })),
    init: vi.fn(async () => {
      calls.push('init');
    }),
    onBeforeDestroy: () => () => {},
    prepareClose: vi.fn().mockResolvedValue(undefined),
    subscribe: (listener: (event: CoreRuntimeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return transport;
}

function mountGuest() {
  const guest = fakeTransport();
  const selectSession = vi.fn();
  const onClose = vi.fn();
  render(
    <CoreContext.Provider
      value={{
        error: null,
        status: 'ready',
        session: 'guest',
        transport: guest as unknown as CoreTransport,
        selectSession,
      }}
    >
      <AccountDialog onClose={onClose} />
    </CoreContext.Provider>,
  );
  return { guest, onClose, selectSession };
}

async function submit() {
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'viewer@kino.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(created[0]?.calls).toContain('dispatch:Authenticate'));
  return created[0]!;
}

beforeEach(() => {
  created.length = 0;
});

describe('account dialog from a guest session', () => {
  it('opens and closes without restarting Core', async () => {
    const { guest, onClose, selectSession } = mountGuest();
    expect(await screen.findByLabelText('Email')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(selectSession).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(guest.destroy).not.toHaveBeenCalled();
  });

  it('signs in through a separate account Core and switches once its save finishes', async () => {
    const { guest, onClose, selectSession } = mountGuest();
    const account = await submit();
    expect(selectSession).not.toHaveBeenCalled();
    await act(async () =>
      account.emit({ name: 'CoreEvent', args: { event: 'UserAuthenticated' } } as CoreRuntimeEvent),
    );
    await waitFor(() => expect(selectSession).toHaveBeenCalledExactlyOnceWith('account'));
    expect(account.calls).toEqual(['init', 'dispatch:Authenticate', 'destroy']);
    expect(account.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      selectSession.mock.invocationCallOrder[0]!,
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(guest.destroy).not.toHaveBeenCalled();
  });

  it('keeps the guest session when Stremio rejects the credentials', async () => {
    const { onClose, selectSession } = mountGuest();
    const account = await submit();
    await act(async () =>
      account.emit({ name: 'CoreEvent', args: { event: 'Error' } } as CoreRuntimeEvent),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stremio did not accept those credentials.',
    );
    expect(account.destroy).toHaveBeenCalledOnce();
    expect(selectSession).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
