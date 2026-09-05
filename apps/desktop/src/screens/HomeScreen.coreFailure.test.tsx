import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CORE_CONTRACT_MARKER, CoreContractError } from '../core/adapters';
import { CoreContext } from '../core/context';
import { coreFailureMessage } from '../core/errors';
import type { CoreTransport } from '../core/transport';
import { t as enUS } from '../locales';
import { HomeScreen } from './HomeScreen';

const contractError = new CoreContractError(
  'ctx',
  'profile.addons[0].manifest.id',
  'expected a name',
);
// Structured clone drops the class and its own fields on the way out of the
// Core worker, so this is what the main thread actually receives.
const clonedContractError = new Error(contractError.message);

function mountHome(readCtx: () => Promise<unknown>, error: string | null = null) {
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    dispatch: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    getState: (async (model: string) =>
      model === 'ctx'
        ? readCtx()
        : model === 'continue_watching_preview'
          ? { items: [] }
          : { catalogs: [], selected: null }) as CoreTransport['getState'],
    subscribe: () => () => {},
  };
  render(
    <CoreContext.Provider
      value={{ error, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <HomeScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
}

it.each([
  ['thrown in this thread', contractError],
  ['flattened by the worker hop', clonedContractError],
])('shows locale copy, not a field path, when reading ctx fails: %s', async (_label, failure) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mountHome(() => Promise.reject(failure));

  const notice = await screen.findByText(new RegExp(enUS.errors.coreContract));
  expect(notice).toHaveTextContent(`Guest profile failed: ${enUS.errors.coreContract}`);
  // The diagnostic detail belongs in the log, not on the screen.
  expect(notice).not.toHaveTextContent('profile.addons[0].manifest.id');
  expect(notice).not.toHaveTextContent(CORE_CONTRACT_MARKER);
  expect(console.error).toHaveBeenCalledWith(
    '[kino:core] ctx state failed',
    expect.stringContaining('ctx.profile.addons[0].manifest.id'),
  );
});

it('shows the same copy when guest initialization fails before a transport exists', async () => {
  // CoreProvider formats its initialization rejection with this function, and
  // Home renders that string directly.
  const initialization = coreFailureMessage(clonedContractError, 'Stremio Core could not start.');
  expect(initialization).toBe(enUS.errors.coreContract);

  mountHome(async () => ({ profile: { addons: [], auth: null, settings: {} } }), initialization);

  expect(await screen.findByText(`Stremio Core failed: ${enUS.errors.coreContract}`)).toBeVisible();
});

it('leaves an ordinary model failure message alone', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mountHome(() => Promise.reject(new Error('The worker stopped responding.')));

  expect(
    await screen.findByText('Guest profile failed: The worker stopped responding.'),
  ).toBeVisible();
});
