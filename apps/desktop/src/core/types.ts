export type CoreModelName =
  'board' | 'continue_watching_preview' | 'ctx' | 'meta_details' | 'player' | 'search';

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
  title?: string | null;
}

export interface ProfileState {
  profile: {
    addons: Array<{ manifest: { id: string; name: string }; transportUrl: string }>;
    auth?: { user: { email?: string; name?: string; uid?: string } };
  };
}
