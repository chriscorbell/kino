import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AddonsScreen } from './AddonsScreen';

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), addons: [] as unknown[] }));
vi.mock('../core/context', () => ({
  useCore: () => ({ transport: { dispatch: fixture.dispatch } }),
}));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    loading: false,
    state: { profile: { addons: fixture.addons } },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fixture.dispatch.mockReset();
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
