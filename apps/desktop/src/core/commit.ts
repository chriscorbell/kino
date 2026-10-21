import { CoreSaveError } from './errors.ts';
import type { CoreTransport } from './transport';

/**
 * Builds `commit` from a dispatch and Core's storage flush. The transport and
 * every fake that stands in for it use this, so a failed flush is a
 * `CoreSaveError` wherever a caller meets it.
 */
export function commitThrough(
  dispatch: (...args: Parameters<CoreTransport['commit']>) => Promise<unknown>,
  flush: () => Promise<unknown>,
): CoreTransport['commit'] {
  return async (...args) => {
    await dispatch(...args);
    try {
      await flush();
    } catch (error) {
      throw new CoreSaveError(error);
    }
  };
}
