import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createCoreTransport, type CoreTransport } from '../core/transport';
import type { CoreAddon } from '../core/types';
import { addon as buildAddon, profile } from '../test/coreState';
import { AddonsScreen } from './AddonsScreen';

const core = vi.hoisted(() => ({
  addons: [] as CoreAddon[],
  calls: [] as string[],
  flush: (): Promise<void> => Promise.resolve(),
  transport: null as CoreTransport | null,
}));
vi.mock('../core/core.worker?worker', () => ({
  default: class extends EventTarget {
    terminate() {}
  },
}));
vi.mock('@stremio/stremio-core-web/bridge.js', () => ({
  default: class {
    async call([method]: string[], args: unknown[]) {
      if (method === 'getState') return profile({ addons: core.addons });
      if (method === 'flush') {
        core.calls.push('flush');
        return core.flush();
      }
      if (method !== 'dispatch') return undefined;
      const action = args[0] as {
        args: { action: string; args: { manifest: Record<string, unknown>; transportUrl: string } };
      };
      const { manifest, transportUrl } = action.args.args;
      core.calls.push(`dispatch ${action.args.action}`);
      core.addons = core.addons.filter((addon) => addon.transportUrl !== transportUrl);
      if (action.args.action === 'InstallAddon')
        core.addons.push(buildAddon(transportUrl, manifest));
    }
  },
}));
vi.mock('../core/context', () => ({
  useCore: () => ({ transport: core.transport }),
}));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({ loading: false, state: profile({ addons: core.addons }) }),
}));

const manifest = { id: 'fixture', name: 'Fixture add-on' };

beforeEach(() => {
  core.transport = createCoreTransport();
});

afterEach(async () => {
  core.flush = () => Promise.resolve();
  await core.transport?.destroy();
  core.addons = [];
  core.calls = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reports an installed add-on only after Core has stored it', async () => {
  let store = () => {};
  core.flush = () => new Promise((resolve) => (store = resolve));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(manifest)));
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'https://addon.invalid/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await waitFor(() => expect(core.calls).toEqual(['dispatch InstallAddon', 'flush']));
  expect(screen.queryByText('The add-on was installed.')).not.toBeInTheDocument();
  store();
  expect(await screen.findByText('The add-on was installed.')).toBeInTheDocument();
});

it('reports a removal that Core could not store', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  core.addons = [buildAddon('https://addon.invalid/manifest.json', manifest)];
  core.flush = () => Promise.reject(new Error('Storage is full.'));
  render(<AddonsScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Fixture add-on' }));
  expect(await screen.findByText('That add-on could not be removed.')).toBeInTheDocument();
  expect(core.calls).toEqual(['dispatch UninstallAddon', 'flush']);
});
