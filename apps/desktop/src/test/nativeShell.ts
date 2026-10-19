import { vi } from 'vitest';

/**
 * A native shell whose WebChannel answers at once with the given objects, beside the ones every
 * connection needs. native/player keeps the connection it makes, so re-import it after this.
 */
export function stubNativeShell(objects: Record<string, object>) {
  const channel = { objects: { kinoDiagnostics: {}, kinoSecureStore: {}, ...objects } };
  vi.stubGlobal('qt', { webChannelTransport: {} });
  vi.stubGlobal(
    'QWebChannel',
    class {
      constructor(_transport: object, connected: (answer: typeof channel) => void) {
        connected(channel);
      }
    },
  );
}
