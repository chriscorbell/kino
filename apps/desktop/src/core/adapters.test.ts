import { describe, expect, it } from 'vitest';

import {
  addToLibraryAction,
  loadCatalogAction,
  loadLibraryAction,
  loadPlayerAction,
} from './actions';
import {
  adaptCoreState,
  adaptDiscoverState,
  adaptLibraryState,
  adaptMetaDetailsState,
  adaptPlayerState,
  addonFromManifest,
  CoreContractError,
} from './adapters';
import { classifySource, sourceKey } from './sources';
import fixtures from './fixtures/core-state.json' with { type: 'json' };
import { preview } from '../test/coreState';
import type { CoreSource } from './types';

type Fixture = keyof Omit<typeof fixtures, '_provenance'>;

function raw(name: Fixture): unknown {
  return fixtures[name].state;
}

const meta = preview({ id: 'kino-fixture', name: 'Synthetic series', type: 'series' });

function sourcesOf(name: Fixture = 'ready_meta_details'): CoreSource[] {
  const resource = adaptMetaDetailsState(raw(name)).streams[0];
  if (resource?.content.type !== 'Ready') throw new Error('The fixture has no ready sources.');
  return resource.content.content;
}

describe('discover', () => {
  it('turns every selectable deep link into a usable catalog request', () => {
    const state = adaptDiscoverState(raw('ready_discover'));
    const genre = state.selectable?.extra.find((extra) => extra.name === 'genre');

    expect(state.selected?.request.path.extra).toEqual([['genre', 'Drama']]);
    expect(genre?.options.map((option) => option.value)).toEqual([null, 'Drama', 'Comedy']);
    expect(genre?.options[2]?.request).toEqual({
      base: 'https://fixture.invalid/manifest.json',
      path: { extra: [['genre', 'Comedy']], id: 'fixture', resource: 'catalog', type: 'series' },
    });
    // The "all" option clears the filter rather than carrying it forward.
    expect(genre?.options[0]?.request?.path.extra).toEqual([]);
    expect(state.selectable?.types.every((type) => type.request !== null)).toBe(true);
    expect(loadCatalogAction(genre?.options[2]?.request ?? null)).toEqual({
      action: 'Load',
      args: {
        model: 'CatalogWithFilters',
        args: { request: genre?.options[2]?.request },
      },
    });
  });

  it('keeps Loading, Ready, and Err apart instead of collapsing them to an empty list', () => {
    expect(adaptDiscoverState(raw('loading_discover')).catalog?.content).toEqual({
      type: 'Loading',
    });
    expect(adaptDiscoverState(raw('ready_discover')).catalog?.content?.type).toBe('Ready');

    const search = adaptCoreState('search', raw('failed_search'));
    const failed = search.catalogs[0]?.content;
    expect(failed?.type).toBe('Err');
    // Board and Search serialize the failure as a string, MetaDetails as an
    // object. Both reach the application as the same value.
    expect(failed?.type === 'Err' && failed.content.kind).toBe('Env');
    const detail = adaptMetaDetailsState(raw('failed_meta_details')).metaItem?.content;
    expect(detail?.type === 'Err' && detail.content.kind).toBe('Env');
  });

  it('accepts every failure payload pinned Core emits, not only Env', () => {
    // A tagged failure carries an object for Env, a plain string for
    // UnexpectedResponse, and nothing at all for EmptyContent, which is what an
    // add-on returning no streams produces on an ordinary browse.
    const withFailure = (content: unknown) => {
      const state = structuredClone(raw('failed_meta_details')) as {
        streams: Array<{ content: unknown }>;
      };
      state.streams[0]!.content = { type: 'Err', content };
      const resource = adaptMetaDetailsState(state).streams[0]?.content;
      if (resource?.type !== 'Err') throw new Error('Expected a failed resource.');
      return resource.content;
    };

    expect(withFailure({ type: 'Env', content: { code: 1, message: 'Offline' } })).toEqual({
      kind: 'Env',
      message: 'Offline',
    });
    expect(
      withFailure({
        type: 'UnexpectedResponse',
        content: 'Only Streams can be converted to Vec < Stream >',
      }),
    ).toEqual({
      kind: 'UnexpectedResponse',
      message: 'Only Streams can be converted to Vec < Stream >',
    });
    expect(withFailure({ type: 'EmptyContent' })).toEqual({
      kind: 'EmptyContent',
      message: 'EmptyContent',
    });
  });

  it('marks a choice with no destination unavailable and rejects a broken one', () => {
    const withLink = (discover: unknown) => ({
      selected: null,
      catalog: null,
      selectable: {
        catalogs: [],
        extra: [],
        nextPage: false,
        types: [{ type: 'movie', selected: false, deepLinks: { discover } }],
      },
    });

    expect(adaptDiscoverState(withLink(null)).selectable?.types[0]?.request).toBeNull();
    expect(adaptDiscoverState(withLink('#/settings')).selectable?.types[0]?.request).toBeNull();
    expect(() => adaptDiscoverState(withLink('#/discover/base/movie'))).toThrow(CoreContractError);
    expect(() => adaptDiscoverState(withLink('#/discover/%zz/movie/top'))).toThrow(
      CoreContractError,
    );
  });

  it('checks what a link decodes to, not just that it decoded', () => {
    const withLink = (discover: string) => ({
      selected: null,
      catalog: null,
      selectable: {
        catalogs: [],
        extra: [],
        nextPage: false,
        types: [{ type: 'movie', selected: false, deepLinks: { discover } }],
      },
    });
    const addon = encodeURIComponent('https://fixture.invalid/manifest.json');

    // Blank add-on, type, and catalog decode successfully and address nothing.
    expect(() => adaptDiscoverState(withLink('#/discover/%20/%20/%20'))).toThrow(
      /discover\.selectable\.types\[0\]\.deepLinks\.discover\.base/,
    );
    expect(() => adaptDiscoverState(withLink(`#/discover/${addon}/%20/top`))).toThrow(/path\.type/);
    expect(() => adaptDiscoverState(withLink(`#/discover/${addon}/movie/%20`))).toThrow(/path\.id/);
    // An add-on is addressed over the network, so a relative base is unusable.
    expect(() => adaptDiscoverState(withLink('#/discover/manifest.json/movie/top'))).toThrow(
      /expected an absolute add-on URL/,
    );
    expect(
      adaptDiscoverState(withLink(`#/discover/${addon}/movie/top`)).selectable?.types[0]?.request,
    ).toEqual({
      base: 'https://fixture.invalid/manifest.json',
      path: { extra: [], id: 'top', resource: 'catalog', type: 'movie' },
    });
  });

  it('rejects a paging flag that is not a boolean', () => {
    const state = structuredClone(raw('ready_discover')) as {
      selectable: { nextPage: unknown };
    };
    state.selectable.nextPage = 'true';
    expect(() => adaptDiscoverState(state)).toThrow(/discover\.selectable\.nextPage/);
  });
});

describe('library', () => {
  it('derives a request for each option without exposing the link format', () => {
    const state = adaptLibraryState(raw('ready_library'));

    expect(state.selected?.request).toEqual({ page: 1, sort: 'lastwatched', type: 'series' });
    expect(state.selectable?.nextPage).toBe(false);
    expect(state.selectable?.types.map((type) => type.request)).toEqual([
      { page: 1, sort: 'lastwatched', type: null },
      { page: 1, sort: 'lastwatched', type: 'series' },
    ]);
    // Changing the sort keeps the selected type and returns to the first page.
    expect(state.selectable?.sorts.find((sort) => sort.sort === 'name')?.request).toEqual({
      page: 1,
      sort: 'name',
      type: 'series',
    });
    expect(loadLibraryAction(state.selectable?.types[0]?.request ?? null)).toEqual({
      action: 'Load',
      args: {
        model: 'LibraryWithFilters',
        args: { request: { page: 1, sort: 'lastwatched', type: null } },
      },
    });
    expect(state.catalog[0]).toMatchObject({ id: 'kino-fixture', type: 'series' });
  });

  it.each([-1, 0, 1.5, '2'])('rejects an unloadable page: %s', (page) => {
    // Core's library paging starts at one.
    const state = structuredClone(raw('ready_library')) as {
      selected: { request: { page: unknown } };
    };
    state.selected.request.page = page;
    expect(() => adaptLibraryState(state)).toThrow(/library\.selected\.request\.page/);
  });
});

describe('sources and playback', () => {
  it('reads a MetaDetails torrent row from announce, not from sources', () => {
    const [, torrent] = sourcesOf();
    expect(JSON.stringify(raw('ready_meta_details'))).toContain('"announce"');
    expect(torrent?.source).toEqual({
      fileIdx: 0,
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      kind: 'torrent',
      sources: ['tracker:https://tracker.invalid/announce', 'dht:0123456789abcdef'],
    });
  });

  it('keeps a resolved torrent a torrent even though Core adds its own URL', () => {
    const resolved = adaptPlayerState(raw('player_torrent')).stream;
    expect(JSON.stringify(raw('player_torrent'))).toContain('http://127.0.0.1:11470/');
    expect(resolved?.type === 'Ready' && resolved.content.source.kind).toBe('torrent');
    expect(resolved?.type === 'Ready' && classifySource(resolved.content.source)).toBe('torrent');
  });

  it('keeps a resolved YouTube stream unsupported rather than a direct URL', () => {
    const resolved = adaptPlayerState(raw('player_youtube')).stream;
    expect(resolved?.type === 'Ready' && resolved.content.source.kind).toBe('youtube');
    expect(resolved?.type === 'Ready' && classifySource(resolved.content.source)).toBe(
      'unsupported',
    );
  });

  it('keeps well-formed unsupported sources visible instead of failing the model', () => {
    expect(sourcesOf().map((source) => classifySource(source.source))).toEqual([
      'direct',
      'torrent',
      'external',
      'unsupported',
      'unsupported',
    ]);
  });

  it('keys a torrent by its discovery hints', () => {
    const [, torrent] = sourcesOf();
    if (!torrent || torrent.source.kind !== 'torrent') throw new Error('Expected a torrent.');
    const key = (source: CoreSource) =>
      sourceKey(source, 'https://fixture.invalid/manifest.json', { meta, video: null });
    expect(key(torrent)).not.toBe(
      key({ ...torrent, source: { ...torrent.source, sources: ['tracker:https://other/a'] } }),
    );
    // Display metadata is not identity.
    expect(key(torrent)).toBe(key({ ...torrent, name: 'Renamed' }));
  });

  it('sends only the Core stream shape back, with announce and proxy headers intact', () => {
    const [direct, torrent, , embedded] = sourcesOf();
    const payload = (source: CoreSource | undefined) =>
      (
        loadPlayerAction({
          meta,
          metaTransportUrl: 'https://fixture.invalid/manifest.json',
          streamTransportUrl: 'https://fixture.invalid/manifest.json',
          stream: source as CoreSource,
          video: null,
          nextVideo: null,
        }).args as { args: { stream: Record<string, unknown> } }
      ).args.stream;

    expect(payload(torrent)).toEqual({
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      fileIdx: 0,
      announce: ['tracker:https://tracker.invalid/announce', 'dht:0123456789abcdef'],
      name: 'Torrent',
    });
    expect(payload(direct)).toEqual({
      url: 'https://media.invalid/fixture.mp4',
      name: 'Direct',
      behaviorHints: {
        filename: 'fixture.mkv',
        proxyHeaders: { request: { Authorization: 'synthetic' } },
        videoHash: '0123456789abcdef',
        videoSize: 123456,
      },
    });
    // No application-only or serializer-only field leaves the app.
    for (const source of [direct, torrent, embedded]) {
      expect(Object.keys(payload(source))).not.toContain('deepLinks');
      expect(Object.keys(payload(source))).not.toContain('lastUsed');
      expect(Object.keys(payload(source))).not.toContain('progress');
      expect(Object.keys(payload(source))).not.toContain('source');
      expect(Object.keys(payload(source))).not.toContain('hints');
    }
  });

  it('rejects malformed playback identity without repeating the payload', () => {
    const token = 'synthetic-secret-3f9c';
    const rejected: Array<[unknown, string]> = [
      [{ infoHash: token, name: token }, 'player.stream.content.infoHash'],
      [{ infoHash: '0'.repeat(40), fileIdx: -1 }, 'player.stream.content.fileIdx'],
      [{ name: token, description: token }, 'player.stream.content'],
    ];
    for (const [stream, field] of rejected) {
      const state = { selected: null, stream: { type: 'Ready', content: stream }, subtitles: [] };
      expect(() => adaptPlayerState(state)).toThrow(CoreContractError);
      try {
        adaptPlayerState(state);
      } catch (error) {
        expect((error as Error).message).toContain(field);
        expect((error as Error).message).not.toContain(token);
      }
    }

    // Request headers travel to a native request, so a non-string value is a
    // contract violation on the source row that carries them.
    expect(() =>
      adaptPlayerState({
        selected: {
          stream: {
            url: `https://media.invalid/${token}.mp4`,
            behaviorHints: { proxyHeaders: { request: { Authorization: 5 } } },
          },
        },
        stream: null,
      }),
    ).toThrow(/player\.selected\.stream\.behaviorHints\.proxyHeaders\.request\[0\]/);
  });

  it('reports a bad header by position, because the name is add-on data too', () => {
    const secret = 'synthetic-secret-8b21';
    // An add-on chooses both halves of a proxy header, and either can carry a
    // credential, so neither may reach a message Kino logs.
    for (const request of [
      { Authorization: secret, [`x-${secret}`]: 42 },
      { [`x-${secret}`]: secret, Authorization: 42 },
    ]) {
      let message = '';
      try {
        adaptPlayerState({
          selected: {
            stream: {
              url: 'https://media.invalid/a.mp4',
              behaviorHints: { proxyHeaders: { request } },
            },
          },
          stream: null,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/behaviorHints\.proxyHeaders\.request\[\d\]/);
      expect(message).not.toContain(secret);
    }
  });

  it('rejects a resume offset that is not a position in the media', () => {
    const withOffset = (timeOffset: unknown) =>
      adaptPlayerState({
        libraryItem: { _id: 'fixture', state: { timeOffset, video_id: null } },
        selected: null,
        stream: null,
      });
    expect(() => withOffset(-1000)).toThrow(/player\.libraryItem\.state\.timeOffset/);
    // Zero and an unreported position are both legitimate.
    expect(withOffset(0).libraryItem?.timeOffset).toBe(0);
    expect(withOffset(null).libraryItem?.timeOffset).toBe(0);
    expect(withOffset(30_000).libraryItem?.timeOffset).toBe(30_000);
  });

  it('rejects an unknown load state and accepts the nulls Core really emits', () => {
    expect(() => adaptPlayerState({ stream: { type: 'Pending' } })).toThrow(/player\.stream\.type/);
    expect(adaptPlayerState({ selected: null, stream: null, subtitles: [], title: null })).toEqual({
      libraryItem: null,
      selected: null,
      stream: null,
      subtitles: [],
      title: null,
    });
  });

  it('validates add-on subtitles and drops plaintext tracks', () => {
    const state = adaptPlayerState({
      stream: null,
      subtitles: [
        { id: 'sub-en', lang: 'eng', url: 'https://fixture.invalid/en.srt' },
        { lang: 'ger', url: 'http://fixture.invalid/de.srt' },
        { url: 'https://fixture.invalid/none.srt' },
      ],
    });
    expect(state.subtitles).toEqual([
      { id: 'sub-en', lang: 'eng', url: 'https://fixture.invalid/en.srt' },
      { id: 'https://fixture.invalid/none.srt', lang: '', url: 'https://fixture.invalid/none.srt' },
    ]);
  });

  it('keeps saved progress and the selected episode usable', () => {
    const details = adaptMetaDetailsState(raw('ready_meta_details'));
    expect(details.libraryItem).toEqual({ id: 'kino-fixture', timeOffset: 0, videoId: null });
    expect(details.selected?.streamPath?.id).toBe('kino-fixture:1:1');
    const watching = adaptCoreState('continue_watching_preview', raw('continue_watching'));
    expect(watching.items[0]).toMatchObject({
      id: 'kino-fixture',
      progress: 25,
      videoId: 'kino-fixture:1:1',
    });
  });
});

describe('library metadata hints', () => {
  it('carries Core’s title hints through the adapter and back out on AddToLibrary', () => {
    // AddToLibrary rewrites the stored item, so a hint Kino never displays is
    // still a hint it must not reset.
    const behaviorHints = {
      defaultVideoId: 'episode-1',
      featuredVideoId: 'episode-2',
      hasScheduledVideos: true,
    };
    const adapted = adaptCoreState('search', {
      selected: null,
      catalogs: [
        {
          id: 'fixture',
          name: 'Fixture',
          type: 'series',
          addon: { manifest: { id: 'fixture', name: 'Fixture' } },
          content: {
            type: 'Ready',
            content: [{ id: 'show', type: 'series', name: 'Fixture', behaviorHints }],
          },
        },
      ],
    });
    const item = adapted.catalogs[0]?.content;
    if (item?.type !== 'Ready' || !item.content[0]) throw new Error('Expected a ready preview.');
    expect(item.content[0]).toMatchObject({
      defaultVideoId: 'episode-1',
      featuredVideoId: 'episode-2',
      hasScheduledVideos: true,
    });
    expect(
      (addToLibraryAction(item.content[0]).args as { args: { behaviorHints: unknown } }).args
        .behaviorHints,
    ).toEqual(behaviorHints);
  });

  it('does not invent hints a title never had', () => {
    expect(
      (addToLibraryAction(preview({ id: 'plain' })).args as { args: { behaviorHints: unknown } })
        .args.behaviorHints,
    ).toEqual({ hasScheduledVideos: false });
  });
});

describe('profile', () => {
  it('accepts a guest profile and preserves manifests and settings for outbound actions', () => {
    const state = adaptCoreState('ctx', raw('guest_ctx'));
    expect(state.profile.auth).toBeNull();
    const fixture = state.profile.addons.find((addon) => addon.manifest.id === 'kino.fixture');
    expect(fixture?.manifest.values).toMatchObject({
      catalogs: expect.any(Array),
      resources: ['catalog', 'meta', 'stream', 'subtitles'],
    });
    expect(state.profile.settings.subtitlesLanguage).toBe('eng');
    // Kino displays two languages but must not reset the rest.
    expect(state.profile.settings.values).toMatchObject({ streamingServerUrl: expect.any(String) });
  });

  it('reads a freshly fetched manifest through the same checks', () => {
    const addon = addonFromManifest('https://new.invalid/manifest.json', {
      id: 'new.addon',
      name: 'New add-on',
      behaviorHints: { configurationRequired: true },
      resources: ['stream'],
    });
    expect(addon.manifest.behaviorHints).toEqual({
      configurable: false,
      configurationRequired: true,
    });
    expect(addon.manifest.values).toMatchObject({ resources: ['stream'] });
    expect(() => addonFromManifest('https://new.invalid/manifest.json', { name: 'No id' })).toThrow(
      CoreContractError,
    );
  });
});

describe('poster shapes', () => {
  it('normalizes the values Core serializes and defaults the rest', () => {
    const shape = (posterShape: unknown) =>
      adaptCoreState('continue_watching_preview', {
        items: [{ _id: 'a', name: 'A', type: 'movie', progress: 0, posterShape, state: {} }],
      }).items[0]?.posterShape;
    expect(shape('landscape')).toBe('landscape');
    expect(shape('square')).toBe('square');
    expect(shape('poster')).toBe('poster');
    expect(shape(null)).toBe('poster');
    expect(shape('Landscape')).toBe('poster');
  });
});
