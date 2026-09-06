import type { CoreTransport } from './transport';
import { createAddonNetwork } from './addonNetwork';
import { fetchNativeAddonRedirect } from '../native/player';

const CINEMETA_MANIFEST_URL = 'https://v3-cinemeta.strem.io/manifest.json';

function isManifest(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

export class GuestCatalogError extends Error {}

export async function ensureGuestCatalog(transport: CoreTransport, signal?: AbortSignal) {
  const context = await transport.getState('ctx');
  if (context.profile.addons.length > 0) return;

  let manifest: unknown;
  try {
    const response = await createAddonNetwork(
      fetch,
      import.meta.env.DEV,
      undefined,
      fetchNativeAddonRedirect,
    ).fetch(CINEMETA_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`Cinemeta manifest returned ${response.status}.`);
    manifest = await response.json();
    if (!isManifest(manifest)) throw new Error('Cinemeta returned an invalid manifest.');
  } catch (error) {
    throw new GuestCatalogError('The default guest catalog could not be loaded.', { cause: error });
  }
  // A response arriving after a session switch must not mutate the old profile.
  signal?.throwIfAborted();

  await transport.dispatch({
    action: 'Ctx',
    args: {
      action: 'InstallAddon',
      args: {
        flags: { official: true, protected: true },
        manifest,
        transportUrl: CINEMETA_MANIFEST_URL,
      },
    },
  });
}
