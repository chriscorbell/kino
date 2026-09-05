import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoreAddon, ProfileState } from '../core/types';

import { AddonsScreen } from './AddonsScreen';

const fixture = vi.hoisted(() => {
  const dispatch = vi.fn();
  const getState = vi.fn();
  return { dispatch, getState, transport: { dispatch, getState }, addons: [] as CoreAddon[] };
});
vi.mock('../core/context', () => ({
  useCore: () => ({ transport: fixture.transport }),
}));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    loading: false,
    state: { profile: { addons: fixture.addons } },
  }),
}));

beforeEach(() => {
  fixture.getState.mockImplementation(
    async () => ({ profile: { addons: fixture.addons } }) as ProfileState,
  );
  fixture.dispatch.mockImplementation(async (action) => {
    if (action.args.action === 'InstallAddon') {
      fixture.addons = [
        ...fixture.addons.filter((addon) => addon.transportUrl !== action.args.args.transportUrl),
        action.args.args,
      ];
    } else if (action.args.action === 'UninstallAddon') {
      fixture.addons = fixture.addons.filter(
        (addon) => addon.transportUrl !== action.args.args.transportUrl,
      );
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fixture.dispatch.mockReset();
  fixture.getState.mockReset();
  fixture.addons = [];
});

it('explains a blocked synced add-on without requesting its logo', () => {
  fixture.addons = [
    {
      transportUrl: 'http://insecure.invalid/token/manifest.json',
      manifest: {
        id: 'insecure',
        name: 'Synced add-on',
        logo: 'http://insecure.invalid/token/logo.png',
      },
    },
  ];
  render(<AddonsScreen />);
  expect(screen.getByRole('status')).toHaveTextContent('requires an HTTPS manifest URL');
  expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove Synced add-on' })).toBeEnabled();
});

it('uses the development loopback exception for manual installation', async () => {
  vi.stubEnv('DEV', true);
  const fetchRequest = vi
    .fn()
    .mockResolvedValue(Response.json({ id: 'local', name: 'Local add-on' }));
  vi.stubGlobal('fetch', fetchRequest);
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'http://127.0.0.1:7000/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await waitFor(() => expect(fixture.dispatch).toHaveBeenCalledOnce());
  expect(fetchRequest.mock.calls[0]?.[1].redirect).toBe('manual');
});

it('explains a redirect and never installs the redirected manifest', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'opaqueredirect', status: 0 }));
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'https://addon.invalid/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await screen.findByText(
    'Blocked. This add-on redirects requests. Install its final HTTPS manifest URL.',
  );
  expect(fixture.dispatch).not.toHaveBeenCalled();
});

it('offers configuration only for supported add-ons, including required configuration', () => {
  fixture.addons = [
    {
      transportUrl: 'https://addon.invalid/old/manifest.json',
      manifest: {
        id: 'config',
        name: 'Configurable add-on',
        behaviorHints: { configurable: true },
      },
    },
    {
      transportUrl: 'https://required.invalid/manifest.json',
      manifest: {
        id: 'required',
        name: 'Required configuration',
        behaviorHints: { configurationRequired: true },
      },
    },
    {
      transportUrl: 'https://plain.invalid/manifest.json',
      manifest: { id: 'plain', name: 'Plain add-on' },
    },
  ];
  render(<AddonsScreen />);
  expect(screen.getByRole('link', { name: 'Configure Configurable add-on' })).toHaveAttribute(
    'href',
    'https://addon.invalid/old/configure',
  );
  expect(
    screen.getByRole('link', { name: 'Configure Required configuration' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Configuration required')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Configure Plain add-on' })).not.toBeInTheDocument();
});

it('directs a configuration-required manifest to Configure without installing it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        id: 'config',
        name: 'Configuration fixture',
        behaviorHints: { configurationRequired: true },
      }),
    ),
  );
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'https://addon.invalid/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await screen.findByRole('link', { name: 'Configure Configuration fixture' });
  expect(fixture.dispatch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Add-on manifest URL')).toHaveValue(
    'https://addon.invalid/manifest.json',
  );
});

it.each(['Replace existing', 'Keep both'] as const)(
  'requires an explicit choice to %s a configured manifest',
  async (choice) => {
    const manifest = {
      id: 'config',
      name: 'Configuration fixture',
      behaviorHints: { configurable: true },
    };
    const old = { transportUrl: 'https://addon.invalid/old/manifest.json', manifest };
    fixture.addons = [old];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(manifest)));
    render(<AddonsScreen />);
    fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
      target: { value: 'stremio://addon.invalid/new/manifest.json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByRole('button', { name: choice });
    expect(fixture.dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: choice }));
    for (const button of screen.getAllByRole('button', { name: 'Remove Configuration fixture' })) {
      expect(button).toBeDisabled();
    }
    await screen.findByText(
      choice === 'Replace existing'
        ? 'The previous configuration was replaced.'
        : 'The add-on was installed.',
    );
    expect(
      fixture.addons.some(
        (addon) => addon.transportUrl === 'https://addon.invalid/new/manifest.json',
      ),
    ).toBe(true);
    expect(fixture.addons.some((addon) => addon.transportUrl === old.transportUrl)).toBe(
      choice === 'Keep both',
    );
    expect(fixture.dispatch.mock.calls.map(([action]) => action.args.action)).toEqual(
      choice === 'Replace existing' ? ['InstallAddon', 'UninstallAddon'] : ['InstallAddon'],
    );
  },
);

it('keeps the old configuration if the new descriptor fails, then retries partial removal', async () => {
  const manifest = {
    id: 'config',
    name: 'Configuration fixture',
    behaviorHints: { configurable: true },
  };
  const old = { transportUrl: 'https://addon.invalid/old/manifest.json', manifest };
  fixture.addons = [old];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(manifest)));
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'https://addon.invalid/new/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await screen.findByRole('button', { name: 'Replace existing' });
  fixture.dispatch.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Replace existing' }));
  await screen.findByRole('alert');
  expect(fixture.addons).toEqual([old]);
  expect(fixture.dispatch).toHaveBeenCalledOnce();
  fixture.dispatch
    .mockImplementationOnce(async (action) => {
      fixture.addons.push(action.args.args);
    })
    .mockRejectedValueOnce(new Error('Synthetic remove failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Replace existing' }));
  await screen.findByText(
    'The new configuration is installed, but a previous configuration could not be removed. Try Replace existing again.',
  );
  expect(fixture.addons).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Replace existing' }));
  await screen.findByText('The previous configuration was replaced.');
  expect(fixture.addons).toHaveLength(1);
  expect(fixture.addons[0]?.transportUrl).toBe('https://addon.invalid/new/manifest.json');
});

it('requires an explicit alongside installation when an existing configuration is protected', async () => {
  const manifest = {
    id: 'config',
    name: 'Configuration fixture',
    behaviorHints: { configurable: true },
  };
  fixture.addons = [
    {
      transportUrl: 'https://addon.invalid/old/manifest.json',
      manifest,
      flags: { protected: true },
    },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(manifest)));
  render(<AddonsScreen />);
  fireEvent.change(screen.getByLabelText('Add-on manifest URL'), {
    target: { value: 'https://addon.invalid/new/manifest.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  expect(await screen.findByRole('button', { name: 'Replace existing' })).toBeDisabled();
  expect(fixture.dispatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
  await screen.findByText('The add-on was installed.');
  expect(fixture.addons).toHaveLength(2);
  expect(fixture.dispatch.mock.calls.map(([action]) => action.args.action)).toEqual([
    'InstallAddon',
  ]);
});
