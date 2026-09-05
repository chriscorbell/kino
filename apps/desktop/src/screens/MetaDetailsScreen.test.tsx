import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreMetaItem, CoreRuntimeEvent, MetaDetailsState } from '../core/types';
import { MetaDetailsScreen } from './MetaDetailsScreen';

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock('../native/externalNavigation', () => ({ openExternalUrl }));
vi.mock('../native/player', () => ({ nativeShellPresent: () => true }));

const meta: CoreMetaItem = {
  id: 'show',
  name: 'Test series',
  type: 'series',
  inLibrary: false,
  watched: false,
  videos: [
    { id: 'ep1', title: 'Episode one', season: 1, episode: 1 },
    { id: 'ep2', title: 'Episode two', season: 1, episode: 2 },
    { id: 'ep3', title: 'Episode three', season: 1, episode: 3 },
  ],
};
const addon = {
  manifest: { id: 'test', name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};

// Shape verified against the pinned Core 0.61.0 WASM serializer. The stream
// resources omit their paths; selected identifies the request for this snapshot.
function details(videoId: string, item = meta): MetaDetailsState {
  return {
    libraryItem: null,
    selected: {
      metaPath: { resource: 'meta', type: item.type, id: item.id, extra: [] },
      streamPath: { resource: 'stream', type: item.type, id: videoId, extra: [] },
      guessStream: true,
    },
    metaItem: { addon, content: { type: 'Ready', content: item } },
    streams: [
      {
        addon,
        content: {
          type: 'Ready',
          content: [
            {
              name: `${videoId} source`,
              url: `https://media.invalid/${videoId}.mp4`,
              deepLinks: { player: '' },
            },
          ],
        },
      },
    ],
  };
}

function mountDetails(
  initial = details('ep1'),
  item = meta,
  initialVideoId: string | null = 'ep1',
) {
  let state = initial;
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const dispatch = vi.fn<CoreTransport['dispatch']>().mockResolvedValue(undefined);
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    dispatch,
    init: vi.fn().mockResolvedValue(undefined),
    getState: async <State,>() => state as State,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const onPlay = vi.fn();
  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <MetaDetailsScreen
        item={item}
        initialVideoId={initialVideoId}
        failedSources={new Map()}
        onBack={vi.fn()}
        onPlay={onPlay}
      />
    </CoreContext.Provider>,
  );
  return {
    dispatch,
    onPlay,
    async publish(next: MetaDetailsState) {
      await act(async () => {
        state = next;
        listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
      });
    },
  };
}

describe('episode source identity', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('prevents playing a retained source while the new Load is pending or still returns old state', async () => {
    const { dispatch, onPlay, publish } = mountDetails();
    const firstSource = await screen.findByRole('button', { name: /ep1 source/ });
    expect(firstSource).toBeEnabled();
    let finishLoad!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    dispatch.mockImplementation((action) =>
      action.action === 'Load' ? pending : Promise.resolve(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    fireEvent.click(firstSource);
    expect(onPlay).not.toHaveBeenCalled();
    expect(firstSource).toBeDisabled();
    expect(screen.getByRole('button', { name: /Episode three/ })).toBeInTheDocument();

    await act(async () => {
      finishLoad();
    });
    fireEvent.click(firstSource);
    expect(onPlay).not.toHaveBeenCalled();
    expect(firstSource).toBeDisabled();

    await publish(details('ep2'));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        video: meta.videos[1],
        stream: expect.objectContaining({ url: 'https://media.invalid/ep2.mp4' }),
      }),
    );
  });

  it('rejects out-of-order snapshots after rapid episode changes', async () => {
    const { onPlay, publish } = mountDetails();
    await screen.findByRole('button', { name: /ep1 source/ });
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    fireEvent.click(screen.getByRole('button', { name: /Episode three/ }));

    await publish(details('ep2'));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /ep2 source/ })).toBeDisabled();

    await publish(details('ep3'));
    expect(screen.getByRole('button', { name: /ep3 source/ })).toBeEnabled();
    await publish(details('ep1'));
    fireEvent.click(screen.getByRole('button', { name: /ep1 source/ }));
    expect(onPlay).not.toHaveBeenCalled();

    await publish(details('ep3'));
    fireEvent.click(screen.getByRole('button', { name: /ep3 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        video: meta.videos[2],
        stream: expect.objectContaining({ url: 'https://media.invalid/ep3.mp4' }),
      }),
    );
  });

  it('keeps guessed movie streams playable and rejects snapshots for a different title', async () => {
    const movie = { ...meta, id: 'movie', type: 'movie', videos: [] };
    const { onPlay, publish } = mountDetails(details('movie', movie), movie, null);
    const source = await screen.findByRole('button', { name: /movie source/ });
    await waitFor(() => expect(source).toBeEnabled());
    fireEvent.click(source);
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ meta: movie, video: null }),
    );
    onPlay.mockClear();
    await publish(details('movie', { ...movie, id: 'another-title' }));
    fireEvent.click(screen.getByRole('button', { name: /movie source/ }));
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('external source approval', () => {
  beforeAll(() => {
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
  afterAll(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  beforeEach(() => {
    openExternalUrl.mockReset().mockResolvedValue(undefined);
  });

  function externalDetails() {
    const state = details('ep1');
    state.streams[0]!.content = {
      type: 'Ready',
      content: [
        {
          name: 'Watch online',
          externalUrl: 'https://watch.example/title/123?region=us',
          deepLinks: { player: '' },
        },
        { name: 'Local file', externalUrl: 'file:///tmp/movie', deepLinks: { player: '' } },
        {
          name: 'Credentials',
          externalUrl: 'https://user:password@watch.example/',
          deepLinks: { player: '' },
        },
        { name: 'Video ID', ytId: '123', deepLinks: { player: '' } },
        { name: 'Frame', playerFrameUrl: 'https://watch.example/frame', deepLinks: { player: '' } },
        { name: 'FTP stream', url: 'ftp://watch.example/movie', deepLinks: { player: '' } },
      ],
    };
    return state;
  }

  it('identifies the destination, cancels without opening, and opens only after approval', async () => {
    const { onPlay } = mountDetails(externalDetails());
    const source = await screen.findByRole('button', { name: /Watch online/ });
    expect(source).toBeEnabled();
    expect(source).toHaveTextContent('Open in browser · watch.example');
    source.focus();
    fireEvent.click(source);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'https://watch.example/title/123?region=us',
    );
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source).toHaveFocus();
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(source);
    fireEvent.click(screen.getByRole('link', { name: 'Open in browser' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
      'https://watch.example/title/123?region=us',
    );
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('keeps a failed opening retryable without sending the source to the player', async () => {
    const { onPlay } = mountDetails(externalDetails());
    openExternalUrl.mockRejectedValueOnce(new Error('No handler'));
    fireEvent.click(await screen.findByRole('button', { name: /Watch online/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Open in browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The browser could not be opened. Try again.',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Open in browser' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(openExternalUrl).toHaveBeenCalledTimes(2);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('explains disabled source types and discards a confirmation when its snapshot changes', async () => {
    const { publish } = mountDetails(externalDetails());
    const source = await screen.findByRole('button', { name: /Watch online/ });
    for (const name of ['Local file', 'Credentials']) {
      const button = screen.getByRole('button', { name: new RegExp(name) });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Use an HTTP or HTTPS URL without a username or password.');
    }
    expect(screen.getByRole('button', { name: /Video ID/ })).toHaveTextContent(
      'YouTube playback is not supported.',
    );
    expect(screen.getByRole('button', { name: /Frame/ })).toHaveTextContent(
      'Embedded players are not supported.',
    );
    expect(screen.getByRole('button', { name: /FTP stream/ })).toHaveTextContent(
      'This stream protocol is not supported.',
    );
    fireEvent.click(source);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await publish(details('ep2'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await publish(externalDetails());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
