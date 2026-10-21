import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

import kino from './eslint/import-boundary.mjs';

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
// session, which then saves the wrong position or unloads a playback it still owns (ADR 0032). The
// transport useCore() hands out cannot name the Player model or send an action that reaches it.
// These zones keep everything that can out of reach. Each is keyed on the module imported and
// lists the only files that may import it, so a barrel or a re-export elsewhere fails at its own
// import rather than handing the module on. A file that needs one joins its zone's `importers`
// with the reason it needs it, and a plant in scripts/test-support/playback-boundary-cases.mjs.
const root = import.meta.dirname;
const src = 'apps/desktop/src/';
const onlySession =
  'Only the playback session in apps/desktop/src/playback/ reads or drives the Player model.';
const sessionApi =
  "Go through the session's API in playback/index.ts: usePlayback, the snapshot and the controls.";
const viaSession = `${onlySession} ${sessionApi}`;
const viaUseCore = `${onlySession} Read Core through useCore(), whose transport cannot reach the Player model.`;
const nativeOnly = `Only the playback session in apps/desktop/src/playback/ talks to the native player. ${sessionApi}`;
const testFiles = ['.test.ts', '.test.tsx'];
const closed = [
  {
    from: [`${src}core/transport.ts`],
    importNames: ['createCoreTransport', 'CoreTransport'],
    importers: [
      // The context types the full transport for the session, which alone reads it.
      `${src}core/context.ts`,
      // The provider creates the app's Core and hands its transport to the context.
      `${src}core/CoreProvider.tsx`,
      // commitThrough builds the full transport's commit, for the transport and its fakes.
      `${src}core/commit.ts`,
    ],
    message: viaUseCore,
  },
  {
    from: [`${src}core/context.ts`],
    importNames: ['CoreContext', 'CoreContextValue'],
    importers: [
      // The provider fills the context.
      `${src}core/CoreProvider.tsx`,
      // usePlaybackHost reads the full transport from it and hands it to the session it starts.
      `${src}playback/react.ts`,
    ],
    message: viaUseCore,
  },
  {
    from: [`${src}core/actions.ts`],
    importNames: ['playerAction', 'loadPlayerAction', 'unloadPlayerAction', 'finalPauseAction'],
    importers: [
      // The session loads the Player model, reports progress to it, and saves and unloads it.
      `${src}playback/session.ts`,
      `${src}playback/progress.ts`,
      `${src}playback/exit.ts`,
    ],
    message: `${onlySession} Start playback with usePlaybackHost, and go through the session's snapshot and controls.`,
  },
  {
    from: [`${src}native/player.ts`],
    importNames: ['connectNativePlayer'],
    // The session's shell dependencies connect it to the native player.
    importers: [`${src}playback/react.ts`],
    message: nativeOnly,
  },
  {
    from: [`${src}playback/`],
    allow: [`${src}playback/index.ts`],
    importers: [`${src}playback/`],
    message: viaSession,
  },
  {
    from: [`${src}test/`, ...testFiles.map((suffix) => `*${suffix}`)],
    message:
      'Test support stays out of the app. Lint leaves tests outside the playback boundary, so they could hand on what only the session may hold.',
  },
];
// Player features also stay off Core and the shell, so they reach playback only through the
// session rather than through the feature transport or a native service.
const playerFeature = [
  {
    from: [
      `${src}core/transport.ts`,
      `${src}core/context.ts`,
      `${src}core/useCoreModel.ts`,
      `${src}core/writes.ts`,
      `${src}core/CoreProvider.tsx`,
    ],
    message: viaSession,
  },
  {
    from: [`${src}native/`],
    message: nativeOnly,
  },
  {
    from: [`${src}core/actions.ts`],
    importNames: ['unloadAction'],
    message: viaSession,
  },
];
// The types a cast may not aim at: the branded actions, the transports and the model names.
const fencedTypes = [
  { from: [`${src}core/writes.ts`, `${src}core/transport.ts`] },
  { from: [`${src}core/types.ts`], importNames: ['ModelOutsideSession'] },
];
const importPaths = [
  'ImportExpression:not([source.type="Literal"]):not([source.type="TemplateLiteral"][source.quasis.length=1])',
  'MemberExpression[object.type="MetaProperty"][property.name=/^glob/]',
  'CallExpression[callee.name="require"]',
].map((selector) => ({
  selector,
  message: 'Import a module by its literal path, so lint can check what it reaches. ' + onlySession,
}));
const scripts = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const app = [`${src}**/*.${scripts}`];
const tests = [`${src}test/**`, ...testFiles.map((suffix) => `${src}**/*${suffix}`)];

// Flat config replaces a rule's options rather than merging them, so each block lists all of its
// selectors or zones.
export default tseslint.config(
  // A build, dist or coverage directory inside the app is still linted, so it cannot hide a file
  // from the boundary.
  {
    ignores: ['**/build/**', '**/dist/**', '**/coverage/**', `!${src}**`, 'mockup/Kino.html'],
  },
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
    files: tests,
    rules: { 'no-restricted-syntax': ['error', ...settingsSpread] },
  },
  // Tests and src/test/ fake the session's dependencies and read the Player model to check what
  // the session did, so the boundary leaves them out; the test zone keeps the app from importing
  // them. An inline comment cannot switch a rule off in the app either.
  {
    files: app,
    ignores: tests,
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    plugins: { kino, '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': true }],
      'kino/import-boundary': ['error', { root, zones: closed }],
      'kino/no-boundary-cast': ['error', { root, zones: fencedTypes }],
      'no-restricted-syntax': ['error', ...settingsSpread, ...importPaths],
    },
  },
  // A type with method members accepts the feature transport without checking the parameters of
  // its methods, so through one a call can name the Player model and still typecheck. TypeScript
  // checks a function-typed property's parameters strictly. core/, native/ and playback/ declare
  // the transports and services, which are not looser views of them.
  {
    files: app,
    ignores: [...tests, `${src}core/**`, `${src}native/**`, `${src}playback/**`],
    rules: { '@typescript-eslint/method-signature-style': ['error', 'property'] },
  },
  // Core's own worker holds every model already, so a cast there reaches nothing new.
  {
    files: [`${src}core/core.worker.ts`],
    rules: { 'kino/no-boundary-cast': 'off' },
  },
  {
    files: [
      `${src}player/**/*.${scripts}`,
      `${src}screens/PlayerScreen*.${scripts}`,
      `${src}components/AudioTrackPicker*.${scripts}`,
      `${src}components/SubtitlePanel*.${scripts}`,
    ],
    ignores: tests,
    rules: { 'kino/import-boundary': ['error', { root, zones: [...playerFeature, ...closed] }] },
  },
);
