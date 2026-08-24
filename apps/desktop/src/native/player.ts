export interface NativePlayerEvent {
  connect(listener: (name: string, payload: Record<string, unknown>) => void): void;
  disconnect(listener: (name: string, payload: Record<string, unknown>) => void): void;
}

export interface NativePlayer {
  load(url: string, forceStereo: boolean): void;
  platform: string;
  playerEvent: NativePlayerEvent;
  seek(seconds: number): void;
  setFullscreen(enabled: boolean): void;
  setMuted(muted: boolean): void;
  setPaused(paused: boolean): void;
  shellVersion: string;
  stop(): void;
}

export interface NativeSecureStore {
  clearStremioAuth(): Promise<boolean>;
  readStremioAuth(): Promise<{ ok: boolean; value: string }>;
  writeStremioAuth(value: string): Promise<boolean>;
}

interface NativeShellConnection {
  player: NativePlayer;
  secureStore: NativeSecureStore;
}

interface WebChannelResult {
  objects: { kinoNative?: NativePlayer; kinoSecureStore?: NativeSecureStore };
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
    script.addEventListener('error', () => reject(new Error('Native channel script failed.')), {
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
          reject(new Error('Native channel is unavailable.'));
          return;
        }
        const timeout = window.setTimeout(
          () => reject(new Error('Native channel timed out.')),
          5_000,
        );
        new Channel(transport, (channel) => {
          window.clearTimeout(timeout);
          const player = channel.objects.kinoNative;
          const secureStore = channel.objects.kinoSecureStore;
          if (!player || !secureStore) {
            reject(new Error('Native shell services are unavailable.'));
            return;
          }
          resolve({ player, secureStore });
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

export async function connectNativeSecureStore() {
  return (await connectNativeShell())?.secureStore ?? null;
}
