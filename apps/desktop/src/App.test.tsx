import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { SETTINGS_STORAGE_KEY } from './settings';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('navigates with the desktop shell', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('starts with manual Skip Intro enabled and automatic skipping disabled', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('switch', { name: 'Skip intro button' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Skip intros automatically' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.click(screen.getByRole('switch', { name: 'Skip intros automatically' }));

    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      automaticIntroSkipping: true,
    });
  });

  it('opens and dismisses Stremio sign-in without leaving the current screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Sign in to Stremio' }));

    expect(screen.getByRole('dialog', { name: 'Sign in to Stremio' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Sign in to Stremio' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});
