import { installDescriptorAction } from './actions';
import type { FeatureTransport } from './transport';
import type { DurableAction } from './writes';
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

export class GuestCatalogError extends Error {
  readonly step: 'load' | 'save';

  constructor(step: 'load' | 'save', options: ErrorOptions) {
    super(
      `The default guest catalog could not be ${step === 'load' ? 'loaded' : 'saved'}.`,
      options,
    );
    this.step = step;
  }
}

// Core keeps an install in memory even when its save fails, so a retry that
// read the profile would find the catalog and stop. It commits the same
// install again instead.
const unsaved = new WeakMap<FeatureTransport, DurableAction>();

export async function ensureGuestCatalog(transport: FeatureTransport, signal?: AbortSignal) {
  const install = unsaved.get(transport) ?? (await guestCatalogInstall(transport, signal));
  if (!install) return;
  try {
    await transport.commit(install);
  } catch (error) {
    unsaved.set(transport, install);
    throw new GuestCatalogError('save', { cause: error });
  }
  unsaved.delete(transport);
}

async function guestCatalogInstall(transport: FeatureTransport, signal?: AbortSignal) {
  const context = await transport.getState('ctx');
  if (context.profile.addons.length > 0) return null;

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
    throw new GuestCatalogError('load', { cause: error });
  }
  // A response arriving after a session switch must not mutate the old profile.
  signal?.throwIfAborted();
  return installDescriptorAction({
    flags: { official: true, protected: true },
    manifest,
    transportUrl: CINEMETA_MANIFEST_URL,
  });
}
