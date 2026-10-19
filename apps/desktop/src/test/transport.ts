import type { CoreTransport } from '../core/transport';

/**
 * Builds a fake transport's `commit` the way the production transport does,
 * from its dispatch and its storage flush, so a test can hold or fail either.
 */
export function commitThrough(
  dispatch: (...args: Parameters<CoreTransport['commit']>) => Promise<unknown>,
  flush: () => Promise<unknown>,
): CoreTransport['commit'] {
  return async (...args) => {
    await dispatch(...args);
    await flush();
  };
}
