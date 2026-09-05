import type { AddonTransportIssue } from './addonNetwork';

// Every type in this module is Kino's own application data. Nothing here is a
// Stremio Core serializer shape: the adapters in ./adapters.ts read the raw
// payload, check each field the application consumes, and produce these values.
// Deep links, `announce`, `_id`, and other wire spellings stay in the adapter.

export type Loadable<Ready, Failure = CoreResourceFailure> =
  { type: 'Err'; content: Failure } | { type: 'Loading' } | { type: 'Ready'; content: Ready };

/**
 * A provider returned an ordinary failure for one resource. Board and Search
 * serialize this as a string, MetaDetails and Player as a tagged object; both
 * normalize here so screens can distinguish a failure from an empty result.
 */
export interface CoreResourceFailure {
  kind: string;
  message: string;
}

export type PosterShape = 'landscape' | 'poster' | 'square';

export interface CatalogPath {
  extra: Array<[string, string]>;
  id: string;
  resource: string;
  type: string;
}

export interface CatalogRequest {
  base: string;
  path: CatalogPath;
}

export interface LibraryRequest {
  page: number;
  sort: string;
  type: string | null;
}

export interface CoreAction {
  action: string;
  args?: unknown;
}

export type CoreRuntimeEvent =
  | { name: 'CoreEvent'; args: { event: string; args?: unknown } }
  // Core also notifies models Kino never reads, so this stays a plain string list.
  | { name: 'NewState'; args: string[] };

/* Streams and playback sources -------------------------------------------- */

/**
 * The playable identity of a source. Core's Stream is an untagged enum, and its
 * Player output adds a resolved `url` beside `infoHash` or `ytId`; the adapter
 * therefore picks the variant from the discriminating field rather than the URL.
 */
export type CoreStreamSource =
  | { fileIdx: number | null; infoHash: string; kind: 'torrent'; sources: string[] }
  | { externalUrl: string; kind: 'external' }
  | { kind: 'playerFrame'; playerFrameUrl: string }
  | { kind: 'url'; url: string }
  | { kind: 'youtube'; ytId: string };

/**
 * Stream hints an add-on supplies with a source. Kino displays some of them and
 * sends all of them back when it loads the player, so a stored source keeps the
 * proxy credentials and file metadata the add-on asked Core to use.
 */
export interface CoreSourceHints {
  bingeGroup: string | null;
  countryWhitelist: string[] | null;
  filename: string | null;
  notWebReady: boolean | null;
  proxyRequestHeaders: Record<string, string> | null;
  proxyResponseHeaders: Record<string, string> | null;
  videoHash: string | null;
  videoSize: number | null;
}

/** A source row an add-on offered for a title, before Core resolves it. */
export interface CoreSource {
  description: string | null;
  hints: CoreSourceHints;
  name: string | null;
  source: CoreStreamSource;
}

/**
 * Core's Player output after it resolved the selected source. It carries no
 * add-on display metadata and no proxy headers; Core consumed those already.
 */
export interface CoreResolvedStream {
  source: CoreStreamSource;
}

export interface AddonSubtitle {
  id: string;
  lang: string;
  url: string;
}

/* Metadata ---------------------------------------------------------------- */

export interface CoreMetaPreview {
  background: string | null;
  defaultVideoId: string | null;
  description: string | null;
  id: string;
  inLibrary: boolean;
  logo: string | null;
  name: string;
  poster: string | null;
  posterShape: PosterShape;
  releaseInfo: string | null;
  released: string | null;
  runtime: string | null;
  type: string;
  watched: boolean;
}

export interface CoreVideo {
  episode: number | null;
  id: string;
  overview: string | null;
  released: string | null;
  season: number | null;
  thumbnail: string | null;
  title: string;
  watched: boolean;
}

export interface CoreMetaItem extends CoreMetaPreview {
  videos: CoreVideo[];
}

export interface CoreCatalog {
  addon: { manifest: { id: string; name: string } };
  content: Loadable<CoreMetaPreview[]> | null;
  id: string;
  name: string;
  type: string;
}

export interface CoreAddonOrigin {
  manifest: { id: string; logo: string | null; name: string };
  transportUrl: string | null;
}

export interface CoreResource<Ready> {
  addon: CoreAddonOrigin;
  content: Loadable<Ready>;
}

/** Saved playback position for the title a screen is showing. */
export interface LibraryPlaybackProgress {
  id: string;
  timeOffset: number;
  videoId: string | null;
}

/* Models ------------------------------------------------------------------ */

export interface BoardState {
  catalogs: CoreCatalog[];
  selected: { extra: Array<[string, string]>; type: string | null } | null;
}

export interface CatalogChoice {
  addon: { manifest: { id: string; name: string } };
  id: string;
  name: string;
  /** Null when Core offers no usable destination for this choice. */
  request: CatalogRequest | null;
  selected: boolean;
}

export interface CatalogWithFiltersState {
  catalog: { content: Loadable<CoreMetaPreview[]> | null } | null;
  paging?: { error: boolean; loading: boolean };
  selectable: {
    catalogs: CatalogChoice[];
    extra: Array<{
      isRequired: boolean;
      name: string;
      options: Array<{ request: CatalogRequest | null; selected: boolean; value: string | null }>;
    }>;
    nextPage: boolean;
    types: Array<{ request: CatalogRequest | null; selected: boolean; type: string }>;
  } | null;
  selected: { request: CatalogRequest } | null;
}

export interface ContinueWatchingItem {
  id: string;
  name: string;
  poster: string | null;
  posterShape: PosterShape;
  progress: number;
  type: string;
  videoId: string | null;
}

export interface ContinueWatchingState {
  items: ContinueWatchingItem[];
}

export interface LibraryItem {
  id: string;
  name: string;
  poster: string | null;
  posterShape: PosterShape;
  progress: number;
  type: string;
}

export interface LibraryState {
  catalog: LibraryItem[];
  selectable: {
    nextPage: boolean;
    sorts: Array<{ request: LibraryRequest; selected: boolean; sort: string }>;
    types: Array<{ request: LibraryRequest; selected: boolean; type: string | null }>;
  } | null;
  selected: { request: LibraryRequest } | null;
}

export interface MetaDetailsState {
  libraryItem: LibraryPlaybackProgress | null;
  metaItem: CoreResource<CoreMetaItem> | null;
  selected: {
    guessStream: boolean;
    metaPath: CatalogPath;
    streamPath: CatalogPath | null;
  } | null;
  streams: Array<CoreResource<CoreSource[]>>;
  title: string | null;
}

export interface PlayerState {
  libraryItem: LibraryPlaybackProgress | null;
  selected: { stream: CoreSource } | null;
  stream: Loadable<CoreResolvedStream> | null;
  subtitles: AddonSubtitle[];
  title: string | null;
}

/* Profile ----------------------------------------------------------------- */

export interface CoreAddonManifest {
  behaviorHints: { configurable: boolean; configurationRequired: boolean };
  description: string | null;
  id: string;
  logo: string | null;
  name: string;
  types: string[];
  /**
   * The complete serialized manifest. Install and uninstall send the descriptor
   * back to Core, which rejects a manifest missing its catalogs or resources, so
   * fields Kino never displays are carried here rather than dropped.
   */
  values: Readonly<Record<string, unknown>>;
  version: string | null;
}

export interface CoreAddon {
  flags: { official: boolean; protected: boolean };
  manifest: CoreAddonManifest;
  transportIssue: AddonTransportIssue | null;
  transportUrl: string;
}

export interface CoreProfileSettings {
  audioLanguage: string | null;
  subtitlesLanguage: string | null;
  /**
   * Every serialized setting. UpdateSettings replaces the whole record, so a
   * dropped field would reset a preference Kino does not present.
   */
  values: Readonly<Record<string, unknown>>;
}

export interface ProfileState {
  profile: {
    addons: CoreAddon[];
    auth: { user: { email: string | null; name: string | null } } | null;
    settings: CoreProfileSettings;
  };
}

/* Model registry ---------------------------------------------------------- */

/**
 * The Core models Kino reads, each bound to the application state its adapter
 * produces. Callers name a model and receive that state; they cannot ask for a
 * different shape.
 */
export interface CoreStateMap {
  board: BoardState;
  continue_watching_preview: ContinueWatchingState;
  ctx: ProfileState;
  discover: CatalogWithFiltersState;
  library: LibraryState;
  meta_details: MetaDetailsState;
  player: PlayerState;
  search: BoardState;
}

export type CoreModelName = keyof CoreStateMap;

const coreModelNames: ReadonlySet<string> = new Set<CoreModelName>([
  'board',
  'continue_watching_preview',
  'ctx',
  'discover',
  'library',
  'meta_details',
  'player',
  'search',
]);

export function isCoreModelName(value: unknown): value is CoreModelName {
  return typeof value === 'string' && coreModelNames.has(value);
}
