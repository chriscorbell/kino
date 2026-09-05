import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreMetaItem, CoreRuntimeEvent, MetaDetailsState } from '../core/types';
import { metaItem, source, urlSource, video } from '../test/coreState';
import { MetaDetailsScreen } from './MetaDetailsScreen';

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock('../native/externalNavigation', () => ({ openExternalUrl }));
vi.mock('../native/player', () => ({ nativeShellPresent: () => true }));

const meta: CoreMetaItem = metaItem({
  id: 'show',
  name: 'Test series',
  type: 'series',
  videos: [
    video({ id: 'ep1', title: 'Episode one', season: 1, episode: 1 }),
    video({ id: 'ep2', title: 'Episode two', season: 1, episode: 2 }),
    video({ id: 'ep3', title: 'Episode three', season: 1, episode: 3 }),
  ],
});
const addon = {
  manifest: { id: 'test', logo: null, name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};

// Shape verified against the pinned Core 0.61.0 WASM serializer. The stream
// resources omit their paths; selected identifies the request for this snapshot.
function details(videoId: string, item = meta): MetaDetailsState {
  return {
    libraryItem: null,
    title: null,
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
            urlSource(`https://media.invalid/${videoId}.mp4`, { name: `${videoId} source` }),
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
    getState: (async () => state) as CoreTransport['getState'],
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

  it('opens sources as an episode dialog without scrolling the series page, then restores focus', async () => {
    const { publish } = mountDetails(details('ep1'), meta, null);
    const episode = await screen.findByRole('button', { name: /Episode two/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ep1 source/ })).not.toBeInTheDocument();
    episode.focus();
    fireEvent.click(episode);
    const dialog = screen.getByRole('dialog', { name: 'Episode two' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Close source picker' })).toHaveFocus();
    await publish(details('ep2'));
    expect(screen.getByRole('button', { name: /ep2 source/ })).toBeEnabled();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close source picker' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(episode).toHaveFocus();
    fireEvent.click(episode);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(episode).toHaveFocus();
  });

  it('gives a seasonless episode no season tab and still lists it', async () => {
    // Core reports an absent season as null. A tab per distinct season must skip
    // that, and the episode itself still belongs in the list.
    const seasonless = metaItem({
      id: 'show',
      name: 'Test series',
      type: 'series',
      videos: [
        video({ id: 'only', title: 'Sole episode', episode: 1 }),
        video({ id: 'other', title: 'Second episode', episode: 2 }),
      ],
    });
    mountDetails(details('only', seasonless), seasonless, 'only');

    expect(await screen.findByRole('button', { name: /Sole episode/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Second episode/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Season/ })).not.toBeInTheDocument();
  });

  it('lists only the selected season when Core numbered the episodes', async () => {
    mountDetails();
    await screen.findByRole('button', { name: /ep1 source/ });
    expect(screen.getByRole('button', { name: 'Season 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Episode/ })).toHaveLength(3);
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
        stream: expect.objectContaining({
          source: { kind: 'url', url: 'https://media.invalid/ep2.mp4' },
        }),
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
        stream: expect.objectContaining({
          source: { kind: 'url', url: 'https://media.invalid/ep3.mp4' },
        }),
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
        source(
          { kind: 'external', externalUrl: 'https://watch.example/title/123?region=us' },
          { name: 'Watch online' },
        ),
        source({ kind: 'external', externalUrl: 'file:///tmp/movie' }, { name: 'Local file' }),
        source(
          { kind: 'external', externalUrl: 'https://user:password@watch.example/' },
          { name: 'Credentials' },
        ),
        source({ kind: 'youtube', ytId: '123' }, { name: 'Video ID' }),
        source(
          { kind: 'playerFrame', playerFrameUrl: 'https://watch.example/frame' },
          { name: 'Frame' },
        ),
        urlSource('ftp://watch.example/movie', { name: 'FTP stream' }),
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
    expect(screen.getByRole('dialog', { name: 'Open in your browser?' })).toHaveTextContent(
      'https://watch.example/title/123?region=us',
    );
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Open in your browser?' })).not.toBeInTheDocument();
    expect(source).toHaveFocus();
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(source);
    fireEvent.click(screen.getByRole('link', { name: 'Open in browser' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Open in your browser?' }),
      ).not.toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Open in your browser?' }),
      ).not.toBeInTheDocument(),
    );
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
    expect(screen.getByRole('dialog', { name: 'Open in your browser?' })).toBeInTheDocument();
    await publish(details('ep2'));
    expect(screen.queryByRole('dialog', { name: 'Open in your browser?' })).not.toBeInTheDocument();
    await publish(externalDetails());
    expect(screen.queryByRole('dialog', { name: 'Open in your browser?' })).not.toBeInTheDocument();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});

describe('Start Over', () => {
  function resumableDetails(videoId: string): MetaDetailsState {
    return {
      ...details(videoId),
      libraryItem: { id: meta.id, timeOffset: 30_000, videoId: 'ep2' },
    };
  }

  it('starts the explicitly selected source over and preserves its episode', async () => {
    const { onPlay } = mountDetails(resumableDetails('ep2'), meta, 'ep2');
    const restart = await screen.findByRole('button', { name: 'Start over' });
    expect(restart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(restart);
    expect(restart).toHaveAttribute('aria-pressed', 'true');
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        resumeMode: 'start-over',
        video: meta.videos[1],
        stream: expect.objectContaining({
          source: { kind: 'url', url: 'https://media.invalid/ep2.mp4' },
        }),
      }),
    );
  });

  it('offers progress only for its episode and resets Start Over after changing episodes', async () => {
    const { onPlay, publish } = mountDetails(resumableDetails('ep1'));
    await screen.findByRole('button', { name: /ep1 source/ });
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    await publish(resumableDetails('ep2'));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    fireEvent.click(screen.getByRole('button', { name: /Episode three/ }));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).not.toHaveBeenCalled();
    await publish(resumableDetails('ep3'));
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    await publish(resumableDetails('ep2'));
    expect(screen.getByRole('button', { name: 'Start over' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ resumeMode: 'resume', video: meta.videos[1] }),
    );
  });
});

it('announces pending and failed stream providers, keeps successful sources, and retries', async () => {
  const pending = details('ep1');
  pending.streams[0]!.content = { type: 'Loading' };
  const test = mountDetails(pending);
  await waitFor(() =>
    expect(screen.getByText('Refreshing sources…')).toHaveAttribute('role', 'status'),
  );
  expect(screen.queryByText('No sources were returned for this title.')).not.toBeInTheDocument();
  const partial = details('ep1');
  partial.streams.push({
    addon: {
      ...addon,
      manifest: { ...addon.manifest, id: 'failed', name: 'Failed provider' },
      transportUrl: 'https://failed.invalid/manifest.json',
    },
    content: { type: 'Err', content: { kind: 'Env', message: 'Unavailable' } },
  });
  await test.publish(partial);
  expect(screen.getByRole('alert')).toHaveTextContent('Failed provider');
  expect(screen.getByRole('button', { name: /ep1 source/ })).toBeEnabled();
  expect(screen.queryByText('No sources were returned for this title.')).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry add-ons' })));
  expect(test.dispatch).toHaveBeenCalledWith({ action: 'Unload' }, 'meta_details');
  await test.publish({
    ...pending,
    metaItem: { addon, content: { type: 'Loading' } },
    selected: null,
    streams: [],
  });
  expect(screen.getByRole('button', { name: /ep1 source/ })).toBeDisabled();
  await test.publish(pending);
  expect(screen.getByRole('button', { name: /ep1 source/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /ep1 source/ }));
  expect(test.onPlay).not.toHaveBeenCalled();
  const empty = details('ep1');
  empty.streams[0]!.content = { type: 'Ready', content: [] };
  await test.publish(empty);
  expect(screen.getByText('No sources were returned for this title.')).toHaveAttribute(
    'role',
    'status',
  );
  expect(screen.queryByRole('button', { name: /ep1 source/ })).not.toBeInTheDocument();
});

it('identifies metadata provider failure and offers retry without an empty-source claim', async () => {
  const failed = details('ep1');
  failed.metaItem!.content = { type: 'Err', content: { kind: 'Env', message: 'Unavailable' } };
  failed.streams = [];
  mountDetails(failed);
  expect(await screen.findByRole('alert')).toHaveTextContent('Test add-on');
  expect(screen.getByRole('button', { name: 'Retry add-ons' })).toBeEnabled();
  expect(screen.queryByText('No sources were returned for this title.')).not.toBeInTheDocument();
  expect(screen.queryByText('Refreshing sources…')).not.toBeInTheDocument();
});
