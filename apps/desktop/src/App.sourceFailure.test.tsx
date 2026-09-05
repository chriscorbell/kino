import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { App } from './App';
import { CoreContext } from './core/context';
import type { CoreTransport } from './core/transport';
import type { PlaybackSelection } from './core/actions';
import type { CoreMetaItem, CoreRuntimeEvent, CoreVideo } from './core/types';
import { metaItem, profile, torrentSource, video } from './test/coreState';

const meta: CoreMetaItem = metaItem({
  id: 'show',
  name: 'Test series',
  type: 'series',
  videos: [
    video({ id: 'ep1', title: 'Episode one', season: 1, episode: 1 }),
    video({ id: 'ep2', title: 'Episode two', season: 1, episode: 2 }),
    video({ id: 's2e5', title: 'Season two episode five', season: 2, episode: 5 }),
    video({ id: 's2e6', title: 'Season two episode six', season: 2, episode: 6 }),
    video({ id: 's2e7', title: 'Season two episode seven', season: 2, episode: 7 }),
  ],
});
const addon = {
  manifest: { id: 'test', logo: null, name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};

vi.mock('./screens/HomeScreen', () => ({
  HomeScreen: ({ onOpen }: { onOpen: (item: CoreMetaItem, videoId: string) => void }) => (
    <button onClick={() => onOpen(meta, 'ep1')}>Open test series</button>
  ),
}));
vi.mock('./screens/PlayerScreen', () => ({
  PlayerScreen: ({
    onSourceFailure,
    onBack,
    onUpNext,
    selection,
  }: {
    onSourceFailure: (message: string) => void;
    onBack: () => void;
    onUpNext: (video: CoreVideo) => void;
    selection: PlaybackSelection;
  }) => (
    <>
      <p>Playing {selection.video?.title}</p>
      <button onClick={() => onSourceFailure('Synthetic source failure')}>Fail playback</button>
      <button onClick={onBack}>Back from playback</button>
      <button onClick={() => selection.nextVideo && onUpNext(selection.nextVideo)}>Up Next</button>
    </>
  ),
}));

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

function mountApp() {
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
    getState: (async (model: string) =>
      model === 'ctx'
        ? profile()
        : {
            libraryItem: null,
            title: null,
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
                  content: [0, 1].map((fileIdx) =>
                    torrentSource({ fileIdx }, { name: `Pack file ${fileIdx}` }),
                  ),
                },
              },
            ],
          }) as CoreTransport['getState'],
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
}

it('marks only the failed torrent file and keeps another episode independent', async () => {
  mountApp();
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

it.each(['Back from playback', 'Fail playback', 'Up Next'])(
  'restores the selected season and episode after %s',
  async (exit) => {
    mountApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open test series' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Season 2' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Season two episode five/ })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Pack file 0/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Pack file 0/ }));
    expect(screen.getByText('Playing Season two episode five')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: exit }));
    const title = exit === 'Up Next' ? 'Season two episode six' : 'Season two episode five';
    await waitFor(() =>
      expect(screen.getByRole('button', { name: new RegExp(title) })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Season 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const source = screen.getByRole('button', { name: /Pack file 0/ });
    await waitFor(() => expect(source).toBeEnabled());
    if (exit === 'Fail playback') expect(within(source).getByText('Failed')).toBeInTheDocument();
    fireEvent.click(source);
    expect(screen.getByText(`Playing ${title}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back from playback' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: new RegExp(title) })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
  },
);
