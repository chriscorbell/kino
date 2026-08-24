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

interface WebChannelResult {
  objects: { kinoNative?: NativePlayer };
}

interface NativeWindow extends Window {
  QWebChannel?: new (transport: object, connected: (channel: WebChannelResult) => void) => unknown;
  qt?: { webChannelTransport?: object };
}

let connection: Promise<NativePlayer | null> | null = null;
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
  return channelScript;
}

export function connectNativePlayer(): Promise<NativePlayer | null> {
  if (!nativeShellPresent()) return Promise.resolve(null);
  if (connection) return connection;

  connection = loadChannelScript().then(
    () =>
      new Promise<NativePlayer>((resolve, reject) => {
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
          if (!channel.objects.kinoNative) {
            reject(new Error('Native player is unavailable.'));
            return;
          }
          resolve(channel.objects.kinoNative);
        });
      }),
  );
  return connection;
}
