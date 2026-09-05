import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { loadCatalogAction } from '../core/actions';
import type { CatalogRequest } from '../core/types';
import { DiscoverScreen } from './DiscoverScreen';

const model = vi.hoisted(() => ({
  read: vi.fn(),
  transport: { dispatch: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: model.transport }) }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: (...args: unknown[]) => model.read(...args),
}));

it('renders all required and optional choices and follows requests that preserve other filters', () => {
  const base = 'https://catalog.invalid/manifest.json';
  // The adapter has already turned each choice's deep link into a request.
  const request = (year: string, language: string | null): CatalogRequest => ({
    base,
    path: {
      resource: 'catalog',
      type: 'movie',
      id: 'new',
      extra: language
        ? [
            ['genre', year],
            ['language', language],
          ]
        : [['genre', year]],
    },
  });
  model.read.mockImplementation((_name, action) => {
    const selected = action.args.args?.request as CatalogRequest | undefined;
    const year = selected?.path.extra.find(([key]) => key === 'genre')?.[1] ?? '2026';
    const language = selected
      ? (selected.path.extra.find(([key]) => key === 'language')?.[1] ?? null)
      : 'English';
    return {
      loading: false,
      error: null,
      state: {
        catalog: { content: { type: 'Ready', content: [] } },
        selectable: {
          nextPage: false,
          types: [],
          catalogs: [
            {
              addon: { manifest: { id: 'fixture', name: 'Fixture' } },
              id: 'new',
              name: 'New',
              request: request(year, language),
              selected: true,
            },
          ],
          extra: [
            {
              name: 'genre',
              isRequired: true,
              options: ['2026', '2025'].map((value) => ({
                value,
                selected: value === year,
                request: request(value, language),
              })),
            },
            {
              name: 'language',
              isRequired: false,
              options: [null, 'English'].map((value) => ({
                value,
                selected: value === language,
                request: request(year, value),
              })),
            },
            { name: 'skip', isRequired: false, options: [] },
          ],
        },
      },
    };
  });
  render(<DiscoverScreen onOpen={vi.fn()} />);
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  const years = screen.getByRole('combobox', { name: 'Year' });
  expect(years).toHaveDisplayValue('2026');
  const languages = screen.getByRole('combobox', { name: 'Language' });
  expect(languages).toHaveDisplayValue('English');
  fireEvent.change(years, { target: { value: '1' } });
  expect(years).toHaveDisplayValue('2025');
  expect(model.read.mock.lastCall?.[1]).toEqual(loadCatalogAction(request('2025', 'English')));
  fireEvent.change(languages, { target: { value: '0' } });
  expect(languages).toHaveDisplayValue('All');
  expect(model.read.mock.lastCall?.[1]).toEqual(loadCatalogAction(request('2025', null)));
});
