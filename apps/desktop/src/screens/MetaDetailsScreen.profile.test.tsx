import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import { metaItem, preview } from '../test/coreState';
import { MetaDetailsScreen } from './MetaDetailsScreen';

const item = preview({ id: 'movie', name: 'Profile fixture', type: 'movie' });

function transport(inLibrary: boolean) {
  return {
    destroy: vi.fn(),
    flush: vi.fn(),
    prepareClose: vi.fn(),
    init: vi.fn(),
    onBeforeDestroy: () => () => {},
    subscribe: () => () => {},
    dispatch: vi.fn<CoreTransport['dispatch']>().mockResolvedValue(undefined),
    getState: (async () => ({
      libraryItem: null,
      streams: [],
      selected: null,
      title: null,
      metaItem: {
        addon: { manifest: { id: 'test', logo: null, name: 'Test' }, transportUrl: null },
        content: { type: 'Ready', content: metaItem({ ...item, inLibrary }) },
      },
    })) as CoreTransport['getState'],
  } satisfies CoreTransport;
}

function view(target: CoreTransport, session: 'guest' | 'account') {
  return (
    <CoreContext.Provider
      value={{ transport: target, session, status: 'ready', error: null, selectSession: vi.fn() }}
    >
      <MetaDetailsScreen item={item} failedSources={new Map()} onBack={vi.fn()} onPlay={vi.fn()} />
    </CoreContext.Provider>
  );
}

it.each([false, true])(
  'drops the guest override when the account membership is %s',
  async (membership) => {
    const guest = transport(membership);
    const account = transport(membership);
    const currentLabel = membership ? 'In Library' : 'Add to Library';
    const optimisticLabel = membership ? 'Add to Library' : 'In Library';
    const rendered = render(view(guest, 'guest'));
    await waitFor(() => expect(screen.getByRole('button', { name: currentLabel })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: currentLabel }));
    expect(screen.getByRole('button', { name: optimisticLabel })).toBeInTheDocument();
    rendered.rerender(view(account, 'account'));
    await waitFor(() => expect(screen.getByRole('button', { name: currentLabel })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: currentLabel }));
    expect(account.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Ctx',
        args: expect.objectContaining({
          action: membership ? 'RemoveFromLibrary' : 'AddToLibrary',
        }),
      }),
    );
  },
);

it('does not let a late guest failure overwrite the account mutation', async () => {
  const guest = transport(false),
    account = transport(false);
  let rejectGuest!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => {
    rejectGuest = reject;
  });
  const rendered = render(view(guest, 'guest'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Library' })).toBeEnabled());
  guest.dispatch.mockImplementation((action) =>
    action.action === 'Ctx' ? pending : Promise.resolve(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));
  rendered.rerender(view(account, 'account'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Library' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));
  await act(async () => rejectGuest(new Error('Old guest request failed.')));
  expect(screen.getByRole('button', { name: 'In Library' })).toBeInTheDocument();
});

it('waits for current-profile metadata before showing or changing membership', async () => {
  const guest = transport(true),
    account = transport(false);
  const rendered = render(view(guest, 'guest'));
  await screen.findByRole('button', { name: 'In Library' });
  let finishLoad!: () => void;
  const loading = new Promise<void>((resolve) => {
    finishLoad = resolve;
  });
  account.dispatch.mockImplementation((action) =>
    action.action === 'Load' ? loading : Promise.resolve(),
  );
  rendered.rerender(view(account, 'account'));
  const pending = screen.getByRole('button', { name: 'Loading library…' });
  expect(pending).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'In Library' })).not.toBeInTheDocument();
  fireEvent.click(pending);
  expect(account.dispatch.mock.calls.some(([action]) => action.action === 'Ctx')).toBe(false);
  await act(async () => finishLoad());
  expect(screen.getByRole('button', { name: 'Add to Library' })).toBeEnabled();
});
