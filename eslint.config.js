import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// A spread copies the caller's snapshot of every Kino setting over whatever the store holds now,
// which undoes a newer change from another screen. The patch type alone allows it.
const settingsSpread = [
  'CallExpression[callee.name=/^update(Settings)?$/] > ObjectExpression > SpreadElement',
  "CallExpression[callee.property.name='update'] > ObjectExpression > SpreadElement",
].map((selector) => ({
  selector,
  message:
    'Patch only the Kino settings this write changes. A spread writes a stale copy of the others.',
}));
// A second reader or writer of the Player model could load, report to or unload it under a running
// session, which then saves the wrong position or unloads a playback it still owns (ADR 0032). An
// action dispatched with no model still reaches the Player model, so the actions themselves stay in
// the session.
const playerModelMessage =
  'Only the playback session in apps/desktop/src/playback/ reads or drives the Player model. Use startPlayback and usePlayback, and go through the session snapshot and controls.';
const playerModel = [
  "CallExpression[callee.name='useCoreModel'][arguments.0.value='player']",
  "CallExpression[callee.property.name='getState'][arguments.0.value='player']",
  "CallExpression[callee.property.name=/^(dispatch|commit)$/][arguments.1.value='player']",
].map((selector) => ({ selector, message: playerModelMessage }));
const playerActions = {
  regex: '(^|/)actions(\\.ts)?$',
  importNames: ['playerAction', 'loadPlayerAction', 'unloadPlayerAction', 'finalPauseAction'],
  message: playerModelMessage,
};

// Flat config replaces a rule's options rather than merging them, so each block lists all of its
// selectors.
export default tseslint.config(
  { ignores: ['**/build/**', '**/dist/**', '**/coverage/**', 'mockup/Kino.html'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...settingsSpread, ...playerModel] },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    ignores: ['apps/desktop/src/playback/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [playerActions] }] },
  },
  {
    files: ['apps/desktop/src/playback/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...settingsSpread] },
  },
);
