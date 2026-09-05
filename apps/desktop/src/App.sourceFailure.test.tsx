import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { App } from './App';
import { CoreContext } from './core/context';
import type { CoreTransport } from './core/transport';
import type { CoreMetaItem, CoreRuntimeEvent } from './core/types';

const meta: CoreMetaItem = {
  id: 'show',
  name: 'Test series',
  type: 'series',
  inLibrary: false,
  watched: false,
  videos: [
    { id: 'ep1', title: 'Episode one', season: 1, episode: 1 },
    { id: 'ep2', title: 'Episode two', season: 1, episode: 2 },
  ],
};
const addon = {
  manifest: { id: 'test', name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};

vi.mock('./screens/HomeScreen', () => ({
  HomeScreen: ({ onOpen }: { onOpen: (item: CoreMetaItem, videoId: string) => void }) => (
    <button onClick={() => onOpen(meta, 'ep1')}>Open test series</button>
  ),
}));
vi.mock('./screens/PlayerScreen', () => ({
  PlayerScreen: ({ onSourceFailure }: { onSourceFailure: (message: string) => void }) => (
    <button onClick={() => onSourceFailure('Synthetic source failure')}>Fail playback</button>
  ),
}));

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

it('marks only the failed torrent file and keeps another episode independent', async () => {
  let videoId = 'ep1';
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    init: vi.fn().mockResolvedValue(undefined),
    dispatch: async (action, model) => {
      if (model === 'meta_details' && action.action === 'Load') {
        videoId = (action.args as { args: { streamPath: { id: string } } }).args.streamPath.id;
        listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
      }
    },
    getState: async <State,>(model: string) =>
      (model === 'ctx'
        ? { profile: { addons: [] } }
        : {
            selected: {
              metaPath: { resource: 'meta', type: 'series', id: meta.id, extra: [] },
              streamPath: { resource: 'stream', type: 'series', id: videoId, extra: [] },
              guessStream: true,
            },
            metaItem: { addon, content: { type: 'Ready', content: meta } },
            streams: [
              {
                addon,
                content: {
                  type: 'Ready',
                  content: [0, 1].map((fileIdx) => ({
                    infoHash: '0123456789abcdef0123456789abcdef01234567',
                    fileIdx,
                    name: `Pack file ${fileIdx}`,
                    deepLinks: { player: '' },
                  })),
                },
              },
            ],
          }) as State,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <App />
    </CoreContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open test series' }));
  const first = await screen.findByRole('button', { name: /Pack file 0/ });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.click(first);
  fireEvent.click(screen.getByRole('button', { name: 'Fail playback' }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('button', { name: /Pack file 0/ })).getByText('Failed'),
    ).toBeInTheDocument(),
  );
  expect(
    within(screen.getByRole('button', { name: /Pack file 1/ })).queryByText('Failed'),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Pack file 0/ })).toBeEnabled());
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  expect(screen.queryByText('Synthetic source failure')).not.toBeInTheDocument();
});
