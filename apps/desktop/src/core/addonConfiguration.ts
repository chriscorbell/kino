import { installAddonAction, uninstallAddonAction } from './actions';
import { addonTransportIssue } from './addonNetwork';
import type { CoreTransport } from './transport';
import type { CoreAddon, ProfileState } from './types';

export function addonManifestUrl(value: string) {
  return value.trim().replace(/^stremio:\/\//i, 'https://');
}

export function addonConfigurationUrl(addon: CoreAddon, development: boolean): string | null {
  const hints = addon.manifest.behaviorHints;
  if (
    !(hints?.configurable === true || hints?.configurationRequired === true) ||
    addonTransportIssue(addon.transportUrl, development)
  )
    return null;
  const url = new URL(addon.transportUrl);
  url.pathname = url.pathname.replace(/[^/]*$/, 'configure');
  return url.href;
}

export class AddonReplacementError extends Error {
  constructor() {
    super('The new configuration is installed, but a previous configuration could not be removed.');
  }
}

export async function installAddonConfiguration(
  transport: CoreTransport,
  addon: CoreAddon,
  previous: CoreAddon[] = [],
) {
  await transport.dispatch(installAddonAction(addon));
  let state = await transport.getState<ProfileState>('ctx');
  if (!state.profile.addons.some((installed) => installed.transportUrl === addon.transportUrl)) {
    throw new Error('The add-on could not be installed.');
  }
  for (const old of previous) {
    const installed = state.profile.addons.find(
      (candidate) => candidate.transportUrl === old.transportUrl,
    );
    if (!installed || installed.transportUrl === addon.transportUrl) continue;
    if (installed.flags?.protected || installed.manifest.id !== addon.manifest.id) {
      throw new AddonReplacementError();
    }
    try {
      await transport.dispatch(uninstallAddonAction(installed));
      state = await transport.getState<ProfileState>('ctx');
      if (state.profile.addons.some((candidate) => candidate.transportUrl === old.transportUrl)) {
        throw new AddonReplacementError();
      }
    } catch {
      throw new AddonReplacementError();
    }
  }
}
