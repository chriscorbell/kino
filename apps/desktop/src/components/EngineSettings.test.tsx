import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EngineSettings } from './EngineSettings';

const fixture = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock('../native/player', () => ({ nativeShellPresent: () => true }));
vi.mock('../native/engine', () => ({
  readEngineSettings: fixture.read,
  updateEngineSettings: fixture.update,
}));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.read.mockResolvedValue({ seedingEnabled: true, btDownloadSpeedHardLimit: 0 });
});

it('loads persisted values and keeps confirmed controls while a save fails, then retries', async () => {
  let finish!: (value: unknown) => void;
  fixture.read.mockResolvedValue({
    seedingEnabled: false,
    btDownloadSpeedHardLimit: 2 * 1024 ** 2,
  });
  fixture.update
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ seedingEnabled: true, btDownloadSpeedHardLimit: 0 });
  render(<EngineSettings />);
  const seeding = screen.getByRole('switch', { name: 'Seeding' });
  const limit = screen.getByRole('combobox', { name: /Download limit/ });
  expect(seeding).toBeDisabled();
  await waitFor(() => expect(seeding).toBeEnabled());
  expect(seeding).toHaveAttribute('aria-checked', 'false');
  expect(limit).toHaveValue(String(2 * 1024 ** 2));
  fireEvent.click(seeding);
  expect(seeding).toBeDisabled();
  expect(seeding).toHaveAttribute('aria-checked', 'false');
  expect(limit).toBeDisabled();
  expect(fixture.update).toHaveBeenCalledExactlyOnceWith({ seedingEnabled: true });
  finish({ seedingEnabled: true, btDownloadSpeedHardLimit: 2 * 1024 ** 2 });
  await waitFor(() => expect(seeding).toBeEnabled());
  fireEvent.change(limit, { target: { value: '0' } });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Torrent settings could not be saved.',
  );
  expect(limit).toHaveValue(String(2 * 1024 ** 2));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(limit).toHaveValue('0'));
  expect(fixture.update).toHaveBeenLastCalledWith({ btDownloadSpeedHardLimit: 0 });
  expect(seeding).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Torrent settings saved.');
});

it('does not present defaults as available when loading fails and can reload', async () => {
  fixture.read.mockRejectedValueOnce(new Error('unavailable'));
  render(<EngineSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Torrent settings could not be loaded.',
  );
  expect(screen.getByRole('switch')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('combobox')).toHaveValue('0');
});
