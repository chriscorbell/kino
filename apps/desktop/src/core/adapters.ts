import type {
  AddonSubtitle,
  BoardState,
  CatalogChoice,
  CatalogPath,
  CatalogRequest,
  CatalogWithFiltersState,
  ContinueWatchingItem,
  ContinueWatchingState,
  CoreAddon,
  CoreAddonManifest,
  CoreAddonOrigin,
  CoreCatalog,
  CoreMetaItem,
  CoreMetaPreview,
  CoreModelName,
  CoreProfileSettings,
  CoreResolvedStream,
  CoreResource,
  CoreResourceFailure,
  CoreSource,
  CoreSourceHints,
  CoreStateMap,
  CoreStreamSource,
  CoreVideo,
  LibraryItem,
  LibraryPlaybackProgress,
  LibraryRequest,
  LibraryState,
  Loadable,
  MetaDetailsState,
  PlayerState,
  PosterShape,
  ProfileState,
} from './types';

/**
 * Adapters run in the Core worker, and structured clone drops an Error's class
 * and its own properties on the way back. This marker travels in the message,
 * so the main thread can still tell a contract failure from any other rejection.
 */
export const CORE_CONTRACT_MARKER = '[kino:core-contract]';

/**
 * A Core payload contradicted the contract the application depends on. The
 * message names the model and the field path only. It never carries the
 * offending value, which can be a stream URL, an add-on token, or a credential.
 * It is a diagnostic: what a person reads comes from the locale catalog.
 */
export class CoreContractError extends Error {
  readonly field: string;
  readonly model: string;

  constructor(model: string, field: string, expectation: string) {
    super(
      `${CORE_CONTRACT_MARKER} Stremio Core sent ${model}.${field} in an unusable form: ${expectation}.`,
    );
    this.name = 'CoreContractError';
    this.field = field;
    this.model = model;
  }
}

/** Recognizes a contract failure whether or not it survived a worker hop. */
export function isCoreContractFailure(error: unknown) {
  return (
    error instanceof CoreContractError ||
    (error instanceof Error && error.message.startsWith(CORE_CONTRACT_MARKER))
  );
}

/* Checked readers ---------------------------------------------------------- */

interface Site {
  field: string;
  model: string;
}

function at(site: Site, segment: string | number): Site {
  if (typeof segment === 'number') return { model: site.model, field: `${site.field}[${segment}]` };
  return { model: site.model, field: site.field ? `${site.field}.${segment}` : segment };
}

function fail(site: Site, expectation: string): never {
  throw new CoreContractError(site.model, site.field || '(root)', expectation);
}

function absent(value: unknown) {
  return value === undefined || value === null;
}

function record(value: unknown, site: Site): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(site, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, site: Site): Record<string, unknown> | null {
  return absent(value) ? null : record(value, site);
}

function list(value: unknown, site: Site): unknown[] {
  if (!Array.isArray(value)) fail(site, 'expected an array');
  return value;
}

function items<Result>(
  value: unknown,
  site: Site,
  read: (entry: unknown, entrySite: Site) => Result,
): Result[] {
  return list(value, site).map((entry, index) => read(entry, at(site, index)));
}

function text(value: unknown, site: Site): string {
  if (typeof value !== 'string') fail(site, 'expected a string');
  return value;
}

/** A required identity: an empty string cannot address a title, video, or add-on. */
function identity(value: unknown, site: Site): string {
  const result = text(value, site);
  if (!result.trim()) fail(site, 'expected a non-empty identifier');
  return result;
}

function optionalText(value: unknown, site: Site): string | null {
  return absent(value) ? null : text(value, site);
}

/** Display copy only: a blank string is normalized away, never invented. */
function displayText(value: unknown, site: Site): string | null {
  const result = optionalText(value, site);
  return result?.trim() ? result : null;
}

function flag(value: unknown, site: Site): boolean {
  if (typeof value !== 'boolean') fail(site, 'expected a boolean');
  return value;
}

function optionalFlag(value: unknown, site: Site): boolean | null {
  return absent(value) ? null : flag(value, site);
}

function flagOr(value: unknown, site: Site, fallback: boolean): boolean {
  return absent(value) ? fallback : flag(value, site);
}

function finiteNumber(value: unknown, site: Site): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(site, 'expected a finite number');
  return value;
}

function optionalFiniteNumber(value: unknown, site: Site): number | null {
  return absent(value) ? null : finiteNumber(value, site);
}

function numberOr(value: unknown, site: Site, fallback: number): number {
  return absent(value) ? fallback : finiteNumber(value, site);
}

function wholeNumber(value: unknown, site: Site): number {
  const result = finiteNumber(value, site);
  if (!Number.isSafeInteger(result) || result < 0) {
    fail(site, 'expected a nonnegative whole number');
  }
  return result;
}

function positiveWholeNumber(value: unknown, site: Site): number {
  const result = wholeNumber(value, site);
  if (result < 1) fail(site, 'expected a whole number of at least one');
  return result;
}

/** A saved offset is a duration; a negative one cannot address a position. */
function nonNegativeNumber(value: unknown, site: Site, fallback: number): number {
  const result = numberOr(value, site, fallback);
  if (result < 0) fail(site, 'expected a nonnegative number');
  return result;
}

function optionalWholeNumber(value: unknown, site: Site): number | null {
  return absent(value) ? null : wholeNumber(value, site);
}

function textList(value: unknown, site: Site): string[] {
  return items(value, site, text);
}

function optionalTextList(value: unknown, site: Site): string[] | null {
  return absent(value) ? null : textList(value, site);
}

/**
 * Header names and values cross into a native request, so both must be strings.
 * A key is add-on-controlled data and can itself carry a credential, so a
 * rejection reports the entry's position and never the key.
 *
 * Building this by assignment would lose a header actually named __proto__:
 * the name is legal in an HTTP field and Core carries it as an own property,
 * but assigning it reaches Object.prototype's setter instead. Collecting
 * entries keeps every own name and leaves the prototype alone.
 */
function headerRecord(value: unknown, site: Site): Record<string, string> | null {
  const source = optionalRecord(value, site);
  if (!source) return null;
  return Object.fromEntries(
    Object.entries(source).map(([name, entry], index): [string, string] => [
      name,
      text(entry, at(site, index)),
    ]),
  );
}

function pairList(value: unknown, site: Site): Array<[string, string]> {
  return items(value, site, (entry, entrySite) => {
    const pair = list(entry, entrySite);
    if (pair.length !== 2) fail(entrySite, 'expected a name and value pair');
    return [text(pair[0], at(entrySite, 0)), text(pair[1], at(entrySite, 1))];
  });
}

function loadable<Ready>(
  value: unknown,
  site: Site,
  ready: (content: unknown, contentSite: Site) => Ready,
): Loadable<Ready> | null {
  if (absent(value)) return null;
  const source = record(value, site);
  switch (source.type) {
    case 'Loading':
      return { type: 'Loading' };
    case 'Ready':
      return { type: 'Ready', content: ready(source.content, at(site, 'content')) };
    case 'Err':
      return { type: 'Err', content: resourceFailure(source.content, at(site, 'content')) };
    default:
      fail(at(site, 'type'), 'expected Loading, Ready, or Err');
  }
}

/**
 * A failed resource is ordinary provider behaviour, never a contract violation,
 * so every shape pinned Core 0.61.0 emits has to survive. Board and Search flatten
 * the failure to a string. MetaDetails and Player tag it, and the tag's payload is
 * an object for Env, a plain string for UnexpectedResponse, and absent for
 * EmptyContent, which is what an add-on returning no streams produces.
 */
function resourceFailure(value: unknown, site: Site): CoreResourceFailure {
  if (typeof value === 'string') {
    const [kind, ...rest] = value.split(': ');
    return rest.length > 0 && kind
      ? { kind, message: rest.join(': ') }
      : { kind: 'Other', message: value };
  }
  const source = record(value, site);
  const kind = text(source.type, at(site, 'type'));
  const detail = source.content;
  if (typeof detail === 'string') return { kind, message: detail };
  const message = absent(detail)
    ? null
    : optionalText(record(detail, at(site, 'content')).message, at(site, 'content.message'));
  return { kind, message: message ?? kind };
}

/* Navigation --------------------------------------------------------------- */

const DISCOVER_PREFIX = '#/discover/';

/**
 * A request base addresses an add-on over the network, so it has to be an
 * absolute URL. Which schemes and hosts are allowed stays with the add-on
 * transport policy, which annotates a stored descriptor rather than hiding it.
 */
function requestBase(value: unknown, site: Site): string {
  const base = identity(value, site);
  try {
    new URL(base);
  } catch {
    fail(site, 'expected an absolute add-on URL');
  }
  return base;
}

/**
 * Core offers catalog selections as deep links, for example
 * "#/discover/{encoded manifest url}/movie/top?genre=Comedy". A choice with no
 * destination is unavailable and stays null; a destination that claims to be a
 * catalog selection but cannot be decoded, or decodes to an unusable add-on,
 * type, or catalog, is a contract violation.
 */
function catalogRequestFromLink(value: unknown, site: Site): CatalogRequest | null {
  if (absent(value)) return null;
  const link = text(value, site);
  if (!link.startsWith(DISCOVER_PREFIX)) return null;

  const [route, query] = link.slice(DISCOVER_PREFIX.length).split('?');
  const [encodedBase, encodedType, encodedId] = route?.split('/') ?? [];
  if (!encodedBase || !encodedType || !encodedId) {
    fail(site, 'expected a catalog link with an add-on, type, and catalog');
  }
  let decoded: { base: string; id: string; type: string };
  try {
    decoded = {
      base: decodeURIComponent(encodedBase),
      id: decodeURIComponent(encodedId),
      type: decodeURIComponent(encodedType),
    };
  } catch {
    fail(site, 'expected a decodable catalog link');
  }
  const extra: Array<[string, string]> = [];
  for (const [name, entry] of new URLSearchParams(query ?? '')) extra.push([name, entry]);
  // Decoding can still yield blanks, so the decoded parts go through the same
  // checks a request Core hands over directly has to pass.
  return catalogRequest(
    {
      base: decoded.base,
      path: { extra, id: decoded.id, resource: 'catalog', type: decoded.type },
    },
    site,
  );
}

function catalogPath(value: unknown, site: Site): CatalogPath {
  const source = record(value, site);
  return {
    extra: pairList(source.extra ?? [], at(site, 'extra')),
    id: identity(source.id, at(site, 'id')),
    resource: identity(source.resource, at(site, 'resource')),
    type: identity(source.type, at(site, 'type')),
  };
}

function catalogRequest(value: unknown, site: Site): CatalogRequest {
  const source = record(value, site);
  return {
    base: requestBase(source.base, at(site, 'base')),
    path: catalogPath(source.path, at(site, 'path')),
  };
}

function libraryRequest(value: unknown, site: Site): LibraryRequest {
  const source = record(value, site);
  return {
    // Core's library paging starts at one; page zero cannot be loaded.
    page: positiveWholeNumber(source.page, at(site, 'page')),
    sort: identity(source.sort, at(site, 'sort')),
    type: optionalText(source.type, at(site, 'type')),
  };
}

/* Sources and streams ------------------------------------------------------ */

const TORRENT_HASH = /^[0-9a-f]{40}$/i;

/**
 * Core resolves a torrent into a stream that carries `url` beside `infoHash`,
 * and a YouTube video into one that carries `url` beside `ytId`. Reading the
 * URL first would classify both as ordinary direct streams, so the identifying
 * field decides the variant and the resolved URL is discarded.
 */
function streamSource(source: Record<string, unknown>, site: Site): CoreStreamSource {
  if (!absent(source.infoHash)) {
    const infoHash = text(source.infoHash, at(site, 'infoHash'));
    if (!TORRENT_HASH.test(infoHash)) {
      fail(at(site, 'infoHash'), 'expected a 40-digit hexadecimal torrent hash');
    }
    return {
      fileIdx: optionalWholeNumber(source.fileIdx, at(site, 'fileIdx')),
      infoHash,
      kind: 'torrent',
      // Core renames an add-on's `sources` to `announce` in every serializer
      // that emits a torrent, including MetaDetails source rows.
      sources: absent(source.announce) ? [] : textList(source.announce, at(site, 'announce')),
    };
  }
  if (!absent(source.ytId)) {
    return { kind: 'youtube', ytId: identity(source.ytId, at(site, 'ytId')) };
  }
  if (!absent(source.externalUrl)) {
    return { externalUrl: identity(source.externalUrl, at(site, 'externalUrl')), kind: 'external' };
  }
  if (!absent(source.playerFrameUrl)) {
    return {
      kind: 'playerFrame',
      playerFrameUrl: identity(source.playerFrameUrl, at(site, 'playerFrameUrl')),
    };
  }
  if (!absent(source.url)) {
    return { kind: 'url', url: identity(source.url, at(site, 'url')) };
  }
  fail(site, 'expected a torrent, URL, YouTube, external, or embedded source');
}

function sourceHints(value: unknown, site: Site): CoreSourceHints {
  const source = optionalRecord(value, site) ?? {};
  const proxy = optionalRecord(source.proxyHeaders, at(site, 'proxyHeaders')) ?? {};
  return {
    bingeGroup: optionalText(source.bingeGroup, at(site, 'bingeGroup')),
    countryWhitelist: optionalTextList(source.countryWhitelist, at(site, 'countryWhitelist')),
    filename: optionalText(source.filename, at(site, 'filename')),
    notWebReady: optionalFlag(source.notWebReady, at(site, 'notWebReady')),
    proxyRequestHeaders: headerRecord(proxy.request, at(site, 'proxyHeaders.request')),
    proxyResponseHeaders: headerRecord(proxy.response, at(site, 'proxyHeaders.response')),
    videoHash: optionalText(source.videoHash, at(site, 'videoHash')),
    videoSize: optionalFiniteNumber(source.videoSize, at(site, 'videoSize')),
  };
}

function adaptSource(value: unknown, site: Site): CoreSource {
  const source = record(value, site);
  return {
    description: displayText(source.description, at(site, 'description')),
    hints: sourceHints(source.behaviorHints, at(site, 'behaviorHints')),
    name: displayText(source.name, at(site, 'name')),
    source: streamSource(source, site),
  };
}

function adaptResolvedStream(value: unknown, site: Site): CoreResolvedStream {
  return { source: streamSource(record(value, site), site) };
}

function adaptSubtitles(value: unknown, site: Site): AddonSubtitle[] {
  return list(value, site).flatMap((entry, index): AddonSubtitle[] => {
    const entrySite = at(site, index);
    const subtitle = record(entry, entrySite);
    const url = text(subtitle.url, at(entrySite, 'url'));
    // Kino loads subtitles over the network in the native player; an add-on
    // that offers a plaintext track is skipped rather than failing the model.
    if (!url.startsWith('https://')) return [];
    const id = optionalText(subtitle.id, at(entrySite, 'id'));
    return [{ id: id ?? url, lang: optionalText(subtitle.lang, at(entrySite, 'lang')) ?? '', url }];
  });
}

/* Metadata ----------------------------------------------------------------- */

function posterShape(value: unknown, site: Site): PosterShape {
  if (absent(value)) return 'poster';
  switch (text(value, site)) {
    case 'landscape':
      return 'landscape';
    case 'square':
      return 'square';
    default:
      return 'poster';
  }
}

function adaptMetaPreview(value: unknown, site: Site): CoreMetaPreview {
  const source = record(value, site);
  const hintsSite = at(site, 'behaviorHints');
  const hints = optionalRecord(source.behaviorHints, hintsSite) ?? {};
  return {
    background: displayText(source.background, at(site, 'background')),
    // Kino only opens the default video itself, but AddToLibrary rewrites the
    // stored item, so the hints Core keeps for a title have to survive the trip.
    defaultVideoId: displayText(hints.defaultVideoId, at(hintsSite, 'defaultVideoId')),
    featuredVideoId: displayText(hints.featuredVideoId, at(hintsSite, 'featuredVideoId')),
    hasScheduledVideos: flagOr(
      hints.hasScheduledVideos,
      at(hintsSite, 'hasScheduledVideos'),
      false,
    ),
    description: displayText(source.description, at(site, 'description')),
    id: identity(source.id, at(site, 'id')),
    inLibrary: flagOr(source.inLibrary, at(site, 'inLibrary'), false),
    logo: displayText(source.logo, at(site, 'logo')),
    name: text(source.name, at(site, 'name')),
    poster: displayText(source.poster, at(site, 'poster')),
    posterShape: posterShape(source.posterShape, at(site, 'posterShape')),
    releaseInfo: displayText(source.releaseInfo, at(site, 'releaseInfo')),
    released: displayText(source.released, at(site, 'released')),
    runtime: displayText(source.runtime, at(site, 'runtime')),
    type: identity(source.type, at(site, 'type')),
    watched: flagOr(source.watched, at(site, 'watched'), false),
  };
}

function adaptVideo(value: unknown, site: Site): CoreVideo {
  const source = record(value, site);
  return {
    episode: optionalWholeNumber(source.episode, at(site, 'episode')),
    id: identity(source.id, at(site, 'id')),
    overview: displayText(source.overview, at(site, 'overview')),
    released: displayText(source.released, at(site, 'released')),
    season: optionalWholeNumber(source.season, at(site, 'season')),
    thumbnail: displayText(source.thumbnail, at(site, 'thumbnail')),
    title: optionalText(source.title, at(site, 'title')) ?? '',
    watched: flagOr(source.watched, at(site, 'watched'), false),
  };
}

function adaptMetaItem(value: unknown, site: Site): CoreMetaItem {
  const source = record(value, site);
  return {
    ...adaptMetaPreview(value, site),
    videos: absent(source.videos) ? [] : items(source.videos, at(site, 'videos'), adaptVideo),
  };
}

function adaptAddonOrigin(value: unknown, site: Site): CoreAddonOrigin {
  const source = record(value, site);
  const manifest = record(source.manifest, at(site, 'manifest'));
  return {
    manifest: {
      id: identity(manifest.id, at(site, 'manifest.id')),
      logo: displayText(manifest.logo, at(site, 'manifest.logo')),
      name: text(manifest.name, at(site, 'manifest.name')),
    },
    transportUrl: optionalText(source.transportUrl, at(site, 'transportUrl')),
  };
}

function adaptResource<Ready>(
  value: unknown,
  site: Site,
  ready: (content: unknown, contentSite: Site) => Ready,
): CoreResource<Ready> {
  const source = record(value, site);
  const content = loadable(source.content, at(site, 'content'), ready);
  if (!content) fail(at(site, 'content'), 'expected a load state');
  return { addon: adaptAddonOrigin(source.addon, at(site, 'addon')), content };
}

function adaptPlaybackProgress(value: unknown, site: Site): LibraryPlaybackProgress | null {
  if (absent(value)) return null;
  const source = record(value, site);
  const state = record(source.state, at(site, 'state'));
  return {
    id: identity(source._id, at(site, '_id')),
    // Resume seeks to this offset. Zero and an unknown position are legitimate;
    // a negative one is not a place in the media.
    timeOffset: nonNegativeNumber(state.timeOffset, at(site, 'state.timeOffset'), 0),
    videoId: displayText(state.video_id, at(site, 'state.video_id')),
  };
}

/* Model adapters ----------------------------------------------------------- */

function adaptCatalog(value: unknown, site: Site): CoreCatalog {
  const source = record(value, site);
  const addon = record(source.addon, at(site, 'addon'));
  const manifest = record(addon.manifest, at(site, 'addon.manifest'));
  return {
    addon: {
      manifest: {
        id: identity(manifest.id, at(site, 'addon.manifest.id')),
        name: text(manifest.name, at(site, 'addon.manifest.name')),
      },
    },
    content: loadable(source.content, at(site, 'content'), (content, contentSite) =>
      items(content, contentSite, adaptMetaPreview),
    ),
    id: identity(source.id, at(site, 'id')),
    name: text(source.name, at(site, 'name')),
    type: identity(source.type, at(site, 'type')),
  };
}

export function adaptBoardState(raw: unknown, model: 'board' | 'search' = 'board'): BoardState {
  const site = { field: '', model };
  const source = record(raw, site);
  const selected = optionalRecord(source.selected, at(site, 'selected'));
  return {
    catalogs: items(source.catalogs, at(site, 'catalogs'), adaptCatalog),
    selected: selected
      ? {
          extra: pairList(selected.extra ?? [], at(site, 'selected.extra')),
          type: optionalText(selected.type, at(site, 'selected.type')),
        }
      : null,
  };
}

export function adaptDiscoverState(raw: unknown): CatalogWithFiltersState {
  const site = { field: '', model: 'discover' };
  const source = record(raw, site);
  const selectableSite = at(site, 'selectable');
  const selectable = optionalRecord(source.selectable, selectableSite);
  const catalogSite = at(site, 'catalog');
  const catalog = optionalRecord(source.catalog, catalogSite);
  const selected = optionalRecord(source.selected, at(site, 'selected'));
  const link = (entry: Record<string, unknown>, entrySite: Site) =>
    catalogRequestFromLink(
      optionalRecord(entry.deepLinks, at(entrySite, 'deepLinks'))?.discover,
      at(entrySite, 'deepLinks.discover'),
    );

  return {
    catalog: catalog
      ? {
          content: loadable(catalog.content, at(catalogSite, 'content'), (content, contentSite) =>
            items(content, contentSite, adaptMetaPreview),
          ),
        }
      : null,
    selectable: selectable
      ? {
          catalogs: items(
            selectable.catalogs,
            at(selectableSite, 'catalogs'),
            (entry, entrySite): CatalogChoice => {
              const choice = record(entry, entrySite);
              const manifest = record(
                record(choice.addon, at(entrySite, 'addon')).manifest,
                at(entrySite, 'addon.manifest'),
              );
              return {
                addon: {
                  manifest: {
                    id: identity(manifest.id, at(entrySite, 'addon.manifest.id')),
                    name: text(manifest.name, at(entrySite, 'addon.manifest.name')),
                  },
                },
                id: identity(choice.id, at(entrySite, 'id')),
                name: text(choice.name, at(entrySite, 'name')),
                request: link(choice, entrySite),
                selected: flag(choice.selected, at(entrySite, 'selected')),
              };
            },
          ),
          extra: items(selectable.extra, at(selectableSite, 'extra'), (entry, entrySite) => {
            const extra = record(entry, entrySite);
            return {
              isRequired: flagOr(extra.isRequired, at(entrySite, 'isRequired'), false),
              name: identity(extra.name, at(entrySite, 'name')),
              options: items(extra.options, at(entrySite, 'options'), (option, optionSite) => {
                const choice = record(option, optionSite);
                return {
                  request: link(choice, optionSite),
                  selected: flag(choice.selected, at(optionSite, 'selected')),
                  value: optionalText(choice.value, at(optionSite, 'value')),
                };
              }),
            };
          }),
          nextPage: flag(selectable.nextPage, at(selectableSite, 'nextPage')),
          types: items(selectable.types, at(selectableSite, 'types'), (entry, entrySite) => {
            const choice = record(entry, entrySite);
            return {
              request: link(choice, entrySite),
              selected: flag(choice.selected, at(entrySite, 'selected')),
              type: identity(choice.type, at(entrySite, 'type')),
            };
          }),
        }
      : null,
    selected: selected
      ? { request: catalogRequest(selected.request, at(site, 'selected.request')) }
      : null,
  };
}

export function adaptLibraryState(raw: unknown): LibraryState {
  const site = { field: '', model: 'library' };
  const source = record(raw, site);
  const selectableSite = at(site, 'selectable');
  const selectable = optionalRecord(source.selectable, selectableSite);
  const selected = optionalRecord(source.selected, at(site, 'selected'));
  const request = selected ? libraryRequest(selected.request, at(site, 'selected.request')) : null;

  // Core encodes each library choice as a "#/library/{type}?sort={sort}" link.
  // The equivalent request comes from the option's own value plus the other
  // axis of the current selection, so the screen never learns that URL format.
  const selectedSort = () => {
    const sorts = selectable ? list(selectable.sorts, at(selectableSite, 'sorts')) : [];
    for (const [index, entry] of sorts.entries()) {
      const entrySite = at(at(selectableSite, 'sorts'), index);
      const choice = record(entry, entrySite);
      if (flag(choice.selected, at(entrySite, 'selected'))) {
        return identity(choice.sort, at(entrySite, 'sort'));
      }
    }
    return request?.sort ?? 'lastwatched';
  };
  const selectedType = () => {
    const types = selectable ? list(selectable.types, at(selectableSite, 'types')) : [];
    for (const [index, entry] of types.entries()) {
      const entrySite = at(at(selectableSite, 'types'), index);
      const choice = record(entry, entrySite);
      if (flag(choice.selected, at(entrySite, 'selected'))) {
        return optionalText(choice.type, at(entrySite, 'type'));
      }
    }
    return request?.type ?? null;
  };

  return {
    catalog: items(source.catalog, at(site, 'catalog'), (entry, entrySite): LibraryItem => {
      const item = record(entry, entrySite);
      return {
        id: identity(item._id, at(entrySite, '_id')),
        name: text(item.name, at(entrySite, 'name')),
        poster: displayText(item.poster, at(entrySite, 'poster')),
        posterShape: posterShape(item.posterShape, at(entrySite, 'posterShape')),
        progress: numberOr(item.progress, at(entrySite, 'progress'), 0),
        type: identity(item.type, at(entrySite, 'type')),
      };
    }),
    selectable: selectable
      ? {
          nextPage: flag(selectable.nextPage, at(selectableSite, 'nextPage')),
          sorts: items(selectable.sorts, at(selectableSite, 'sorts'), (entry, entrySite) => {
            const choice = record(entry, entrySite);
            const sort = identity(choice.sort, at(entrySite, 'sort'));
            return {
              request: { page: 1, sort, type: selectedType() },
              selected: flag(choice.selected, at(entrySite, 'selected')),
              sort,
            };
          }),
          types: items(selectable.types, at(selectableSite, 'types'), (entry, entrySite) => {
            const choice = record(entry, entrySite);
            const type = optionalText(choice.type, at(entrySite, 'type'));
            return {
              request: { page: 1, sort: selectedSort(), type },
              selected: flag(choice.selected, at(entrySite, 'selected')),
              type,
            };
          }),
        }
      : null,
    selected: request ? { request } : null,
  };
}

// Core owns the compressed stream format. A missing or obsolete deep link only
// disables direct resume; it must not hide the title or its saved progress.
function rememberedSource(
  item: Record<string, unknown>,
  site: Site,
  decodeStream?: (encoded: string) => unknown,
): ContinueWatchingItem['rememberedSource'] {
  if (!decodeStream) return null;
  try {
    const links = record(item.deepLinks, at(site, 'deepLinks'));
    const link = text(links.player, at(site, 'deepLinks.player'));
    if (!link.startsWith('#/player/')) return null;
    const parts = link.slice('#/player/'.length).split('?')[0]?.split('/').map(decodeURIComponent);
    if (!parts || parts.length !== 6) return null;
    const [encoded, transportUrl, , type, id, videoId] = parts;
    const state = record(item.state, at(site, 'state'));
    if (!encoded || !transportUrl || type !== item.type || id !== item._id) return null;
    if (videoId !== (state.videoId ?? (type === 'series' ? null : id))) return null;
    return {
      stream: adaptSource(decodeStream(encoded), at(site, 'deepLinks.player')),
      transportUrl,
    };
  } catch {
    return null;
  }
}

export function adaptContinueWatchingState(
  raw: unknown,
  decodeStream?: (encoded: string) => unknown,
): ContinueWatchingState {
  const site = { field: '', model: 'continue_watching_preview' };
  const source = record(raw, site);
  return {
    items: items(source.items, at(site, 'items'), (entry, entrySite): ContinueWatchingItem => {
      const item = record(entry, entrySite);
      const state = optionalRecord(item.state, at(entrySite, 'state')) ?? {};
      return {
        id: identity(item._id, at(entrySite, '_id')),
        name: text(item.name, at(entrySite, 'name')),
        poster: displayText(item.poster, at(entrySite, 'poster')),
        posterShape: posterShape(item.posterShape, at(entrySite, 'posterShape')),
        progress: numberOr(item.progress, at(entrySite, 'progress'), 0),
        rememberedSource: rememberedSource(item, entrySite, decodeStream),
        type: identity(item.type, at(entrySite, 'type')),
        videoId: displayText(state.videoId, at(entrySite, 'state.videoId')),
      };
    }),
  };
}

export function adaptMetaDetailsState(raw: unknown): MetaDetailsState {
  const site = { field: '', model: 'meta_details' };
  const source = record(raw, site);
  const selectedSite = at(site, 'selected');
  const selected = optionalRecord(source.selected, selectedSite);
  return {
    libraryItem: adaptPlaybackProgress(source.libraryItem, at(site, 'libraryItem')),
    metaItem: absent(source.metaItem)
      ? null
      : adaptResource(source.metaItem, at(site, 'metaItem'), adaptMetaItem),
    selected: selected
      ? {
          guessStream: flagOr(selected.guessStream, at(selectedSite, 'guessStream'), false),
          metaPath: catalogPath(selected.metaPath, at(selectedSite, 'metaPath')),
          streamPath: absent(selected.streamPath)
            ? null
            : catalogPath(selected.streamPath, at(selectedSite, 'streamPath')),
        }
      : null,
    streams: items(source.streams, at(site, 'streams'), (entry, entrySite) =>
      adaptResource(entry, entrySite, (content, contentSite) =>
        items(content, contentSite, adaptSource),
      ),
    ),
    title: displayText(source.title, at(site, 'title')),
  };
}

export function adaptPlayerState(raw: unknown): PlayerState {
  const site = { field: '', model: 'player' };
  const source = record(raw, site);
  const selected = optionalRecord(source.selected, at(site, 'selected'));
  return {
    libraryItem: adaptPlaybackProgress(source.libraryItem, at(site, 'libraryItem')),
    selected: selected
      ? { stream: adaptSource(selected.stream, at(site, 'selected.stream')) }
      : null,
    stream: loadable(source.stream, at(site, 'stream'), adaptResolvedStream),
    subtitles: absent(source.subtitles)
      ? []
      : adaptSubtitles(source.subtitles, at(site, 'subtitles')),
    title: displayText(source.title, at(site, 'title')),
  };
}

/* Profile ------------------------------------------------------------------ */

function adaptAddonManifest(value: unknown, site: Site): CoreAddonManifest {
  const source = record(value, site);
  const hints = optionalRecord(source.behaviorHints, at(site, 'behaviorHints')) ?? {};
  return {
    behaviorHints: {
      configurable: flagOr(hints.configurable, at(site, 'behaviorHints.configurable'), false),
      configurationRequired: flagOr(
        hints.configurationRequired,
        at(site, 'behaviorHints.configurationRequired'),
        false,
      ),
    },
    description: displayText(source.description, at(site, 'description')),
    id: identity(source.id, at(site, 'id')),
    logo: displayText(source.logo, at(site, 'logo')),
    name: text(source.name, at(site, 'name')),
    types: absent(source.types) ? [] : textList(source.types, at(site, 'types')),
    values: source,
    version: displayText(source.version, at(site, 'version')),
  };
}

function adaptAddon(value: unknown, site: Site): CoreAddon {
  const source = record(value, site);
  const flags = optionalRecord(source.flags, at(site, 'flags')) ?? {};
  return {
    flags: {
      official: flagOr(flags.official, at(site, 'flags.official'), false),
      protected: flagOr(flags.protected, at(site, 'flags.protected'), false),
    },
    manifest: adaptAddonManifest(source.manifest, at(site, 'manifest')),
    // A descriptor Core has not annotated yet is still displayable; the worker
    // fills this in from the add-on transport policy after adapting.
    transportIssue: null,
    transportUrl: identity(source.transportUrl, at(site, 'transportUrl')),
  };
}

function adaptProfileSettings(value: unknown, site: Site): CoreProfileSettings {
  const source = optionalRecord(value, site) ?? {};
  return {
    audioLanguage: optionalText(source.audioLanguage, at(site, 'audioLanguage')),
    subtitlesLanguage: optionalText(source.subtitlesLanguage, at(site, 'subtitlesLanguage')),
    values: source,
  };
}

export function adaptProfileState(raw: unknown): ProfileState {
  const site = { field: '', model: 'ctx' };
  const source = record(raw, site);
  const profileSite = at(site, 'profile');
  const profile = record(source.profile, profileSite);
  // A guest profile has no session at all, so auth is genuinely null here.
  const auth = optionalRecord(profile.auth, at(profileSite, 'auth'));
  const user = auth ? record(auth.user, at(profileSite, 'auth.user')) : null;
  return {
    profile: {
      addons: items(profile.addons, at(profileSite, 'addons'), adaptAddon),
      auth: user
        ? {
            user: {
              email: displayText(user.email, at(profileSite, 'auth.user.email')),
              name: displayText(user.name, at(profileSite, 'auth.user.name')),
            },
          }
        : null,
      settings: adaptProfileSettings(profile.settings, at(profileSite, 'settings')),
    },
  };
}

/**
 * Read a descriptor Kino fetched itself. The same checks apply as for a stored
 * descriptor so an install sends Core the shape it accepts, and the complete
 * manifest is carried through unchanged.
 */
export function addonFromManifest(transportUrl: string, manifest: unknown): CoreAddon {
  const site = { field: 'manifest', model: 'addon' };
  return {
    flags: { official: false, protected: false },
    manifest: adaptAddonManifest(manifest, site),
    transportIssue: null,
    transportUrl,
  };
}

/* Entry point -------------------------------------------------------------- */

const adapters = {
  board: (raw: unknown) => adaptBoardState(raw, 'board'),
  continue_watching_preview: adaptContinueWatchingState,
  ctx: adaptProfileState,
  discover: adaptDiscoverState,
  library: adaptLibraryState,
  meta_details: adaptMetaDetailsState,
  player: adaptPlayerState,
  search: (raw: unknown) => adaptBoardState(raw, 'search'),
} satisfies { [Model in CoreModelName]: (raw: unknown) => CoreStateMap[Model] };

/**
 * Turn one model's raw payload into its application state. The lookup is
 * exhaustive over CoreStateMap above, so the returned value matches the model
 * key; TypeScript cannot narrow the union of adapter results by itself.
 */
export function adaptCoreState<Model extends CoreModelName>(
  model: Model,
  raw: unknown,
): CoreStateMap[Model] {
  return adapters[model](raw) as CoreStateMap[Model];
}
