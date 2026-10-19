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

function fakeTransport(auth: unknown = null) {
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const calls: string[] = [];
  const state = { auth };
  const transport = {
    calls,
    state,
    emit: (event: CoreRuntimeEvent) => listeners.forEach((listener) => listener(event)),
    destroy: vi.fn(async () => {
      calls.push('destroy');
    }),
    dispatch: vi.fn(async (action: { args?: { action?: string } }) => {
      calls.push(`dispatch:${action.args?.action ?? ''}`);
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(async () => ({ profile: { auth: state.auth } })),
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

describe('account dialog in a signed-in account session', () => {
  function mountSignedIn() {
    const account = fakeTransport({ key: 'synthetic', user: { email: 'viewer@kino.invalid' } });
    let store!: () => void;
    let fail!: (error: Error) => void;
    const saved = new Promise<void>((resolve, reject) => {
      store = resolve;
      fail = reject;
    });
    // Like Core, clear the user and announce it at dispatch, before the save settles.
    account.commit.mockImplementationOnce(() => {
      account.state.auth = null;
      account.emit({ name: 'NewState', args: ['ctx'] });
      return saved;
    });
    const selectSession = vi.fn();
    const onClose = vi.fn();
    render(
      <CoreContext.Provider
        value={{
          error: null,
          status: 'ready',
          session: 'account',
          transport: account as unknown as CoreTransport,
          selectSession,
        }}
      >
        <AccountDialog onClose={onClose} />
      </CoreContext.Provider>,
    );
    return { account, fail, onClose, selectSession, store };
  }

  async function signOut(account: ReturnType<typeof fakeTransport>) {
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(account.getState).toHaveBeenCalledTimes(2));
    await act(async () => {});
  }

  it('keeps the account shown and the dialog open until Core stores the sign-out', async () => {
    const { account, onClose, selectSession, store } = mountSignedIn();
    await signOut(account);
    expect(screen.getByText('viewer@kino.invalid')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Signing out…' }));
    expect(account.commit).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    await act(async () => store());
    expect(selectSession).toHaveBeenCalledExactlyOnceWith('guest');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports a sign-out Core could not store and keeps the dialog open', async () => {
    const { account, fail, onClose, selectSession } = mountSignedIn();
    await signOut(account);
    await act(async () => fail(new Error('Core storage did not finish in time.')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sign-out could not be saved. This account may still be signed in after Kino restarts.',
    );
    expect(selectSession).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
