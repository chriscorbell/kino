import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { App } from '../App';
import { CoreRecovery } from '../components/CoreRecovery';
import { t as enUS } from '../locales';
import { profile } from '../test/coreState';
import { CoreProvider } from './CoreProvider';
import { useCore } from './context';
import type { CoreSession } from './storage';
import type { CoreTransport } from './transport';

const control = vi.hoisted(() => ({
  init: vi.fn(),
  transports: [] as CoreTransport[],
}));
vi.mock('./transport', () => ({
  createCoreTransport: (session: CoreSession) => {
    const transport: CoreTransport = {
      init: () => control.init(session),
      destroy: vi.fn().mockResolvedValue(undefined),
      dispatch: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      prepareClose: vi.fn().mockResolvedValue(undefined),
      onBeforeDestroy: () => () => {},
      getState: vi.fn(async (model: string) => {
        if (model === 'ctx') return profile();
        if (model === 'board') return { catalogs: [], selected: null };
        return { items: [] };
      }) as CoreTransport['getState'],
      subscribe: () => () => {},
    };
    control.transports.push(transport);
    return transport;
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  control.transports.length = 0;
  control.init.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'com.linvo.cinemeta', name: 'Cinemeta' })),
      ),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

function Probe() {
  const core = useCore();
  return (
    <>
      <output data-testid="status">{core.status}</output>
      <CoreRecovery />
      <button onClick={() => core.selectSession('account')}>Account</button>
    </>
  );
}

it('keeps Core and Settings usable after an optional catalog failure, then retries without replacing Core', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
  render(
    <CoreProvider>
      <App />
    </CoreProvider>,
  );
  expect(await screen.findByRole('button', { name: 'Retry guest catalog' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('switch', { name: 'Skip intro button' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry guest catalog' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Retry guest catalog' })).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(control.transports[0]!.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.objectContaining({ action: 'InstallAddon' }) }),
    ),
  );
  expect(control.transports).toHaveLength(1);
});

it('retries failed startup with a new transport and waits for teardown', async () => {
  control.init.mockRejectedValueOnce(new Error('WASM could not load.'));
  render(
    <CoreProvider>
      <Probe />
    </CoreProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('WASM could not load.');
  let finish!: () => void;
  vi.mocked(control.transports[0]!.destroy).mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry Stremio Core' }));
  expect(screen.getByTestId('status')).toHaveTextContent('loading');
  await waitFor(() => expect(control.transports[0]!.destroy).toHaveBeenCalledOnce());
  expect(control.transports).toHaveLength(1);
  await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
  expect(control.transports).toHaveLength(2);
});

it('shows account initialization failures with retry and a working guest escape', async () => {
  control.init.mockImplementation((session: CoreSession) =>
    session === 'account'
      ? Promise.reject(new Error('Account storage unavailable.'))
      : Promise.resolve(),
  );
  render(
    <CoreProvider>
      <App />
    </CoreProvider>,
  );
  await waitFor(() => expect(control.init).toHaveBeenCalledWith('guest'));
  fireEvent.click(screen.getByRole('button', { name: enUS.account.signInTitle }));
  const dialog = within(screen.getByRole('dialog'));
  expect(await dialog.findByRole('alert')).toHaveTextContent('Account storage unavailable.');
  expect(dialog.queryByRole('button', { name: 'Preparing account…' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Retry Stremio Core' }));
  await waitFor(() =>
    expect(control.init.mock.calls.filter(([session]) => session === 'account')).toHaveLength(2),
  );
  fireEvent.click(await dialog.findByRole('button', { name: 'Continue as guest' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(control.init.mock.calls.filter(([session]) => session === 'guest')).toHaveLength(2),
  );
});

it('does not install a late guest manifest after changing sessions', async () => {
  let respond!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  render(
    <CoreProvider>
      <Probe />
    </CoreProvider>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const guest = control.transports[0]!;
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  await waitFor(() => expect(control.transports).toHaveLength(2));
  await act(async () =>
    respond(new Response(JSON.stringify({ id: 'com.linvo.cinemeta', name: 'Cinemeta' }))),
  );
  expect(guest.dispatch).not.toHaveBeenCalled();
  expect(screen.getByTestId('status')).toHaveTextContent('ready');
});
