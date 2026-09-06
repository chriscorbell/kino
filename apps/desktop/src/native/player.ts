import { t } from '../locales';
export interface NativePlayerEvent {
  connect(listener: (name: string, payload: Record<string, unknown>) => void): void;
  disconnect(listener: (name: string, payload: Record<string, unknown>) => void): void;
}

export interface NativeEngineEvent {
  connect(listener: (url: string, error: string) => void): void;
  disconnect(listener: (url: string, error: string) => void): void;
}

export interface NativePlayer {
  readonly fullscreen: boolean;
  fullscreenChanged: {
    connect(listener: () => void): void;
    disconnect(listener: () => void): void;
  };
  openAccountCreation(): Promise<boolean>;
  addSubtitles(url: string, title: string, lang: string): void;
  load(url: string, forceStereo: boolean, headers: Record<string, string>): void;
  loadWithAudioLanguage?(
    url: string,
    forceStereo: boolean,
    headers: Record<string, string>,
    audioLanguage: string,
  ): void;
  pauseAndSnapshot(): Promise<{ duration: number; time: number }>;
  platform: string;
  playerEvent: NativePlayerEvent;
  seek(seconds: number): void;
  setFullscreen(enabled: boolean): void;
  setMuted(muted: boolean): void;
  setVolume(percent: number): void;
  setNowPlayingMetadata(title: string, subtitle: string): void;
  setPaused(paused: boolean): void;
  setSubtitleDelay(seconds: number): void;
  setSubtitlePosition(position: number): void;
  setSubtitleScale(scale: number): void;
  setSubtitleTrack(id: number): void;
  setAudioTrack(id: number): void;
  shellVersion: string;
  startStreamingEngine(): void;
  stop(): void;
  streamingEngineChanged: NativeEngineEvent;
}

export interface NativeInterface {
  setScale(percent: number): Promise<boolean>;
}

export interface NativeExternalNavigation {
  openUrl(url: string): Promise<boolean>;
}

export interface NativeAddonNetwork {
  get(url: string): Promise<{ status: number; body: string }>;
}

export interface NativeDiagnostics {
  openNotices(): Promise<boolean>;
  copyDiagnosticSummary(): Promise<boolean>;
  cacheBytes(): Promise<number>;
  clearCache(): Promise<boolean>;
  revealLogs(): Promise<boolean>;
}

export interface NativeLifecycle {
  setReady(ready: boolean): void;
  acknowledgeClose(requestId: number, saved: boolean): void;
  closeRequested: {
    connect(listener: (requestId: number) => void): void;
    disconnect(listener: (requestId: number) => void): void;
  };
}

export interface NativeSecureStore {
  clearStremioAuth(): Promise<boolean>;
  readStremioAuth(): Promise<{ ok: boolean; value: string }>;
  writeStremioAuth(value: string): Promise<boolean>;
}

interface NativeShellConnection {
  addonNetwork: NativeAddonNetwork | null;
  interface: NativeInterface | null;
  externalNavigation: NativeExternalNavigation | null;
  lifecycle: NativeLifecycle | null;
  diagnostics: NativeDiagnostics;
  player: NativePlayer;
  secureStore: NativeSecureStore;
}

interface WebChannelResult {
  objects: {
    kinoAddonNetwork?: NativeAddonNetwork;
    kinoDiagnostics?: NativeDiagnostics;
    kinoInterface?: NativeInterface;
    kinoExternalNavigation?: NativeExternalNavigation;
    kinoLifecycle?: NativeLifecycle;
    kinoNative?: NativePlayer;
    kinoSecureStore?: NativeSecureStore;
  };
}

interface NativeWindow extends Window {
  QWebChannel?: new (transport: object, connected: (channel: WebChannelResult) => void) => unknown;
  qt?: { webChannelTransport?: object };
}

let connection: Promise<NativeShellConnection | null> | null = null;
let channelScript: Promise<void> | null = null;

function nativeWindow() {
  return window as NativeWindow;
}

export function nativeShellPresent() {
  return Boolean(nativeWindow().qt?.webChannelTransport);
}

function loadChannelScript() {
  const target = nativeWindow();
  if (target.QWebChannel) return Promise.resolve();
  if (channelScript) return channelScript;

  channelScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'qrc:///qtwebchannel/qwebchannel.js';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(t.core.nativeScriptFailed)), {
      once: true,
    });
    document.head.append(script);
  });
  const pendingScript = channelScript;
  void pendingScript.catch(() => {
    if (channelScript === pendingScript) channelScript = null;
  });
  return channelScript;
}

function connectNativeShell(): Promise<NativeShellConnection | null> {
  if (!nativeShellPresent()) return Promise.resolve(null);
  if (connection) return connection;

  connection = loadChannelScript().then(
    () =>
      new Promise<NativeShellConnection>((resolve, reject) => {
        const target = nativeWindow();
        const transport = target.qt?.webChannelTransport;
        const Channel = target.QWebChannel;
        if (!transport || !Channel) {
          reject(new Error(t.core.nativeUnavailable));
          return;
        }
        const timeout = window.setTimeout(() => reject(new Error(t.core.nativeTimeout)), 5_000);
        new Channel(transport, (channel) => {
          window.clearTimeout(timeout);
          const diagnostics = channel.objects.kinoDiagnostics;
          const player = channel.objects.kinoNative;
          const secureStore = channel.objects.kinoSecureStore;
          if (!diagnostics || !player || !secureStore) {
            reject(new Error(t.core.nativeServicesUnavailable));
            return;
          }
          resolve({
            addonNetwork: channel.objects.kinoAddonNetwork ?? null,
            interface: channel.objects.kinoInterface ?? null,
            diagnostics,
            externalNavigation: channel.objects.kinoExternalNavigation ?? null,
            player,
            secureStore,
            lifecycle: channel.objects.kinoLifecycle ?? null,
          });
        });
      }),
  );
  const pendingConnection = connection;
  void pendingConnection.catch(() => {
    if (connection === pendingConnection) connection = null;
  });
  return connection;
}

export async function connectNativePlayer() {
  return (await connectNativeShell())?.player ?? null;
}

export async function fetchNativeAddonRedirect(url: string) {
  return (await connectNativeShell())?.addonNetwork?.get(url) ?? null;
}

export async function openAccountCreation() {
  const player = await connectNativePlayer();
  if (!player || !(await player.openAccountCreation())) {
    throw new Error('Account creation could not be opened.');
  }
}

export async function connectNativeLifecycle() {
  return (await connectNativeShell())?.lifecycle ?? null;
}

export async function connectNativeDiagnostics() {
  return (await connectNativeShell())?.diagnostics ?? null;
}

export async function connectNativeSecureStore() {
  return (await connectNativeShell())?.secureStore ?? null;
}

export async function connectNativeExternalNavigation() {
  return (await connectNativeShell())?.externalNavigation ?? null;
}

export async function connectNativeInterface() {
  return (await connectNativeShell())?.interface ?? null;
}
