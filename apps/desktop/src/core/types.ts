export type CoreModelName =
  | 'board'
  | 'continue_watching_preview'
  | 'ctx'
  | 'discover'
  | 'installed_addons'
  | 'library'
  | 'meta_details'
  | 'player'
  | 'search';

export interface CatalogRequest {
  base: string;
  path: {
    extra: Array<[string, string]>;
    id: string;
    resource: string;
    type: string;
  };
}

interface DiscoverDeepLink {
  deepLinks?: { discover?: string };
  selected: boolean;
}

export interface CatalogWithFiltersState {
  catalog: {
    content: Loadable<CoreMetaPreview[], string> | null;
  } | null;
  selectable: {
    catalogs: Array<
      DiscoverDeepLink & {
        addon: { manifest: { id: string; name: string } };
        id: string;
        name: string;
      }
    >;
    extra: Array<{
      isRequired: boolean;
      name: string;
      options: Array<DiscoverDeepLink & { value: string | null }>;
    }>;
    types: Array<DiscoverDeepLink & { type: string }>;
  } | null;
  selected: { request: CatalogRequest } | null;
}

export interface CoreAction {
  action: string;
  args?: unknown;
}

export type CoreRuntimeEvent =
  | { name: 'CoreEvent'; args: { event: string; args?: unknown } }
  | { name: 'NewState'; args: CoreModelName[] };

export type Loadable<Ready, Failure = unknown> =
  { type: 'Err'; content: Failure } | { type: 'Loading' } | { type: 'Ready'; content: Ready };

export interface CoreMetaPreview {
  background?: string | null;
  behaviorHints?: Record<string, unknown>;
  deepLinks?: Record<string, unknown>;
  description?: string | null;
  id: string;
  inLibrary: boolean;
  links?: Array<{ category: string; name: string; url: string }>;
  logo?: string | null;
  name: string;
  poster?: string | null;
  posterShape?: 'Landscape' | 'Poster' | 'Square';
  releaseInfo?: string | null;
  released?: string | null;
  runtime?: string | null;
  type: string;
  watched: boolean;
}

export interface CoreCatalog {
  addon: { manifest: { id: string; name: string } };
  content: Loadable<CoreMetaPreview[], string> | null;
  id: string;
  name: string;
  type: string;
}

export interface BoardState {
  catalogs: CoreCatalog[];
  selected: { extra: Array<[string, string]>; type?: string | null } | null;
}

export interface ContinueWatchingItem {
  _id: string;
  name: string;
  poster?: string | null;
  posterShape: 'Landscape' | 'Poster' | 'Square';
  progress: number;
  state: { videoId?: string | null };
  type: string;
}

export interface ContinueWatchingState {
  items: ContinueWatchingItem[];
}

export interface CoreVideo {
  deepLinks?: Record<string, unknown>;
  episode?: number;
  id: string;
  overview?: string | null;
  progress?: number | null;
  released?: string | null;
  season?: number;
  thumbnail?: string | null;
  title: string;
  watched?: boolean;
}

export interface StreamDeepLinks {
  externalPlayer?: {
    download?: string | null;
    magnet?: string | null;
    streaming?: string | null;
  };
  player: string;
}

export interface CoreStream {
  behaviorHints?: {
    filename?: string | null;
    notWebReady?: boolean;
    videoHash?: string | null;
    videoSize?: number | null;
  };
  deepLinks: StreamDeepLinks;
  description?: string | null;
  externalUrl?: string | null;
  fileIdx?: number | null;
  infoHash?: string;
  lastUsed?: boolean | null;
  name?: string | null;
  playerFrameUrl?: string;
  progress?: number | null;
  sources?: string[];
  url?: string;
  ytId?: string;
}

export interface CoreMetaItem extends CoreMetaPreview {
  videos: CoreVideo[];
}

interface CoreResource<Ready> {
  addon: {
    manifest: { id: string; logo?: string | null; name: string };
    transportUrl?: string;
  };
  content: Loadable<Ready>;
}

export interface MetaDetailsState {
  libraryItem: unknown | null;
  metaItem: CoreResource<CoreMetaItem> | null;
  selected: unknown | null;
  streams: Array<CoreResource<CoreStream[]>>;
  title?: string | null;
}

export interface PlayerState {
  addon?: { manifest: { name: string } } | null;
  introOutro?: {
    intro?: { duration?: number | null; from: number; to: number } | null;
    outro?: number | null;
  } | null;
  libraryItem?: {
    _id: string;
    state: { timeOffset: number; video_id?: string | null };
  } | null;
  selected: { stream: CoreStream } | null;
  stream: Loadable<CoreStream> | null;
  subtitles?: unknown;
  title?: string | null;
}

export interface LibraryRequest {
  page: number;
  sort: string;
  type: string | null;
}

export interface LibraryItem {
  _id: string;
  name: string;
  poster?: string | null;
  posterShape?: 'Landscape' | 'Poster' | 'Square';
  progress?: number | null;
  type: string;
}

export interface LibraryState {
  catalog: LibraryItem[];
  selectable: {
    nextPage: { request: LibraryRequest } | null;
    sorts: Array<{ request: LibraryRequest; selected: boolean; sort: string }>;
    types: Array<{ request: LibraryRequest; selected: boolean; type: string | null }>;
  } | null;
  selected: { request: LibraryRequest } | null;
}

export interface CoreAddon {
  flags?: { official?: boolean; protected?: boolean };
  manifest: {
    description?: string | null;
    id: string;
    logo?: string | null;
    name: string;
    types?: string[];
    version?: string;
  };
  transportUrl: string;
}

export interface ProfileState {
  profile: {
    addons: CoreAddon[];
    auth?: { user: { email?: string; name?: string; uid?: string } };
    settings?: { subtitlesLanguage?: string | null };
  };
}
