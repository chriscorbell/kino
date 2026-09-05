import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings';
import { SettingsScreen } from './SettingsScreen';

const fixture = vi.hoisted(() => ({
  diagnostics: {
    cacheBytes: vi.fn().mockResolvedValue(0),
    copyDiagnosticSummary: vi.fn(),
  },
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  connectNativeDiagnostics: async () => fixture.diagnostics,
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: null }) }));
vi.mock('../core/useCoreModel', () => ({ useCoreModel: () => ({ state: null }) }));
beforeEach(() => vi.clearAllMocks());

it('copies diagnostics only on request and announces completion', async () => {
  let finish!: (value: boolean) => void;
  fixture.diagnostics.copyDiagnosticSummary.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SettingsScreen settings={defaultSettings} onChange={vi.fn()} />);
  const copy = screen.getByRole('button', { name: 'Copy diagnostic summary' });
  expect(fixture.diagnostics.copyDiagnosticSummary).not.toHaveBeenCalled();
  fireEvent.click(copy);
  await waitFor(() => expect(copy).toBeDisabled());
  await waitFor(() =>
    expect(fixture.diagnostics.copyDiagnosticSummary).toHaveBeenCalledExactlyOnceWith(),
  );
  finish(true);
  expect(await screen.findByRole('status')).toHaveTextContent('Diagnostic summary copied.');
  expect(copy).toBeEnabled();
});

it.each([false, new Error('Synthetic clipboard failure')])(
  'reports a copy failure and permits retry (%s)',
  async (failure) => {
    if (failure instanceof Error)
      fixture.diagnostics.copyDiagnosticSummary.mockRejectedValueOnce(failure);
    else fixture.diagnostics.copyDiagnosticSummary.mockResolvedValueOnce(failure);
    fixture.diagnostics.copyDiagnosticSummary.mockResolvedValue(true);
    render(<SettingsScreen settings={defaultSettings} onChange={vi.fn()} />);
    const copy = screen.getByRole('button', { name: 'Copy diagnostic summary' });
    fireEvent.click(copy);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The summary could not be copied. Try again.',
    );
    fireEvent.click(copy);
    expect(await screen.findByRole('status')).toHaveTextContent('Diagnostic summary copied.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);
