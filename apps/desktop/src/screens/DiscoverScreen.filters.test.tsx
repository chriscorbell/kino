import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { loadCatalogAction } from '../core/actions';
import type { CatalogRequest } from '../core/types';
import { DiscoverScreen } from './DiscoverScreen';

const model = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: (...args: unknown[]) => model.read(...args),
}));

it('renders all required and optional choices and follows links that preserve other filters', () => {
  const base = 'https://catalog.invalid/manifest.json';
  const link = (year: string, language: string | null) =>
    `#/discover/${encodeURIComponent(base)}/movie/new?genre=${year}${language ? `&language=${language}` : ''}`;
  model.read.mockImplementation((_name, action) => {
    const request = action.args.args?.request as CatalogRequest | undefined;
    const year = request?.path.extra.find(([key]) => key === 'genre')?.[1] ?? '2026';
    const language = request
      ? (request.path.extra.find(([key]) => key === 'language')?.[1] ?? null)
      : 'English';
    return {
      loading: false,
      error: null,
      state: {
        catalog: { content: { type: 'Ready', content: [] } },
        selectable: {
          types: [],
          catalogs: [
            { addon: { manifest: { id: 'fixture' } }, id: 'new', name: 'New', selected: true },
          ],
          extra: [
            {
              name: 'genre',
              isRequired: true,
              options: ['2026', '2025'].map((value) => ({
                value,
                selected: value === year,
                deepLinks: { discover: link(value, language) },
              })),
            },
            {
              name: 'language',
              isRequired: false,
              options: [null, 'English'].map((value) => ({
                value,
                selected: value === language,
                deepLinks: { discover: link(year, value) },
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
  expect(model.read.mock.lastCall?.[1]).toEqual(
    loadCatalogAction({
      base,
      path: {
        resource: 'catalog',
        type: 'movie',
        id: 'new',
        extra: [
          ['genre', '2025'],
          ['language', 'English'],
        ],
      },
    }),
  );
  fireEvent.change(languages, { target: { value: '0' } });
  expect(languages).toHaveDisplayValue('All');
  expect(model.read.mock.lastCall?.[1]).toEqual(
    loadCatalogAction({
      base,
      path: { resource: 'catalog', type: 'movie', id: 'new', extra: [['genre', '2025']] },
    }),
  );
});
