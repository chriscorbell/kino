import type { CoreTransport } from './transport';
import { createAddonNetwork } from './addonNetwork';

const CINEMETA_MANIFEST_URL = 'https://v3-cinemeta.strem.io/manifest.json';

function isManifest(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

export async function ensureGuestCatalog(transport: CoreTransport) {
  const context = await transport.getState('ctx');
  if (context.profile.addons.length > 0) return;

  const response = await createAddonNetwork(fetch, import.meta.env.DEV).fetch(
    CINEMETA_MANIFEST_URL,
    {
      headers: { Accept: 'application/json' },
    },
  );
  if (!response.ok) throw new Error(`Cinemeta manifest returned ${response.status}.`);
  const manifest: unknown = await response.json();
  if (!isManifest(manifest)) throw new Error('Cinemeta returned an invalid manifest.');

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
