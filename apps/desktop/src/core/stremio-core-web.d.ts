declare module '@stremio/stremio-core-web/bridge.js' {
  interface MessageEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    postMessage(message: unknown): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  }

  export default class Bridge {
    constructor(scope: object, handler: MessageEndpoint);
    call<Result>(path: string[], args: unknown[]): Promise<Result>;
  }
}

declare module '@stremio/stremio-core-web/stremio_core_web.js' {
  export function decode_stream(stream: string): unknown;
  export function dispatch(action: unknown, field: unknown, locationHash: string): void;
  export function encode_stream(stream: unknown): string | null;
  export function get_state(field: unknown): unknown;
  export default function initializeWasm(path: string): Promise<unknown>;
  export function initialize_runtime(emit: (event: unknown) => void): Promise<void>;
}
