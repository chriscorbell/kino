// Planted files for check-playback-boundary.mjs. Each is linted and typechecked in memory at its
// path, as if it sat in the tree, and tries one way around the boundary and nothing else. `lint`
// is 'pass' or the one rule that must report it, and `tsc` is 'pass' or 'fail'; a JavaScript
// plant has no `tsc`, because the app's TypeScript program does not include JavaScript. A plant
// with a `config` lints with that nested eslint.config.js beside it.

const src = 'apps/desktop/src';
const boundary = 'kino/import-boundary';
const cast = 'kino/no-boundary-cast';
const syntax = 'no-restricted-syntax';

/** A hook that holds the transport useCore() gives, and runs `body` against it. */
const withTransport = (imports, body) => `import { useCore } from '../core/context';
${imports}
export function usePlant() {
  const { transport } = useCore();
  return async () => {
    if (!transport) return;
${body}
  };
}
`;

const slug = (name) => name.replaceAll(/[^a-z]+/g, '-');
const plant = (name, path, code, lint, tsc = 'pass', config) => ({
  name,
  path: `${src}/${path}`,
  code,
  lint,
  tsc: path.endsWith('.js') ? null : tsc,
  config,
});
/** Where a case with this label and name sits. */
const at = (label, name) =>
  label === 'screen'
    ? `screens/HomeScreen.plant-${slug(name)}.ts`
    : `player/plant-${slug(name)}.ts`;
/** A file that imports one name and exports it as `plant`. */
const importing = (name, specifier) =>
  `import { ${name} } from '${specifier}';\nexport const plant = ${name};\n`;
const useCoreImport = importing('useCore', '../core/context');
const looseCommit = '{ commit(action: { action: string }, model?: string): Promise<void> }';
const looseCommitProperty =
  '{ commit: (action: { action: string }, model?: string) => Promise<void> }';

// Ways a screen holding the feature transport could still name or reach the Player model. The
// types stop each.
const typeForms = {
  'const model': ['', "const model = 'player';\nawait transport.getState(model);"],
  'template literal': ['', 'await transport.getState(`player`);'],
  'as const': [
    "import { loadBoardAction } from '../core/actions';",
    "await transport.dispatch(loadBoardAction, 'player' as const);",
  ],
  destructured: ['', "const { getState } = transport;\nawait getState('player');"],
  computed: [
    "import { logoutAction } from '../core/actions';",
    "await transport['commit'](logoutAction, 'player');",
  ],
  spread: [
    "import { loadBoardAction } from '../core/actions';",
    "const args = [loadBoardAction, 'player'] as const;\nawait transport.dispatch(...args);",
  ],
  'brand helper': [
    "import { durable } from '../core/writes';",
    "await transport.commit(durable({ action: 'Unload' }));",
  ],
  'model-less unload': [
    "import { unloadAction } from '../core/actions';",
    'await transport.dispatch(unloadAction);',
  ],
  widened: [
    "import { unloadAction } from '../core/actions';\nimport type { TransientAction } from '../core/writes';",
    'const action: TransientAction = unloadAction;\nawait transport.dispatch(action);',
  ],
  'looser property type': [
    '',
    `const loose: ${looseCommitProperty} = transport;\nawait loose.commit({ action: 'Unload' }, 'player');`,
  ],
  'helper with a looser property parameter': [
    `const save = (core: ${looseCommitProperty}) => core.commit({ action: 'Unload' }, 'player');`,
    'await save(transport);',
  ],
};
const screenTypes = Object.entries(typeForms).map(([name, [imports, body]]) =>
  plant(`screen, ${name}`, at('screen', name), withTransport(imports, body), 'pass', 'fail'),
);

// What a player feature may not import even though a screen may. Each plant imports one module.
const playerImport = (name, code, path = at('player feature', name)) =>
  plant(`player feature, ${name}`, path, code, boundary);
const playerImports = [
  playerImport('useCore', useCoreImport),
  playerImport('useCoreModel', importing('useCoreModel', '../core/useCoreModel')),
  playerImport('CoreProvider', importing('CoreProvider', '../core/CoreProvider')),
  playerImport(
    'feature transport type',
    "import type { FeatureTransport } from '../core/transport';\nexport type Plant = FeatureTransport;\n",
  ),
  playerImport(
    'action types',
    "import type { DurableAction } from '../core/writes';\nexport type Plant = DurableAction;\n",
  ),
  playerImport('unloadAction', importing('unloadAction', '../core/actions')),
  playerImport('native service', importing('connectNativeInterface', '../native/player')),
  playerImport(
    'dynamic import of the actions',
    "export const plant = () => import('../core/actions');\n",
  ),
  playerImport('a .tsx file', useCoreImport, 'player/plant-tsx.tsx'),
  playerImport('PlayerScreen', useCoreImport, 'screens/PlayerScreen.plant.tsx'),
  playerImport(
    'PlayerScreen in JavaScript',
    importing('useCore', '../core/context.ts'),
    'screens/PlayerScreen.plant.js',
  ),
  playerImport('AudioTrackPicker', useCoreImport, 'components/AudioTrackPicker.plant.tsx'),
  playerImport('SubtitlePanel', useCoreImport, 'components/SubtitlePanel.plant.tsx'),
];

// What only the session, and the few files the lint config names, may import. Whatever imports
// it, barrels and re-exports included, fails at that import, so nothing can hand it on.
const closed = (name, path, code, tsc = 'pass') => plant(name, path, code, boundary, tsc);
const closedImports = [
  closed(
    'screen, CoreContext',
    'screens/HomeScreen.plant-core-context.ts',
    `import { useContext } from 'react';

import { CoreContext } from '../core/context';

export function usePlant() {
  const { transport } = useContext(CoreContext);
  return () => transport?.getState('player');
}
`,
  ),
  closed('core module, CoreContext', 'core/plant.ts', importing('CoreContext', './context')),
  closed(
    'core module, full transport',
    'core/plant-full-transport.ts',
    importing('createCoreTransport', './transport'),
  ),
  closed(
    'updates, full transport',
    'updates/plant-full-transport.ts',
    importing('createCoreTransport', '../core/transport'),
  ),
  closed(
    'session module, full transport',
    'playback/plant-full-transport.ts',
    importing('createCoreTransport', '../core/transport'),
  ),
  closed(
    'session module, CoreContext',
    'playback/plant-core-context.ts',
    importing('CoreContext', '../core/context'),
  ),
  closed(
    'session module, Player builder',
    'playback/plant-player-builder.ts',
    importing('unloadPlayerAction', '../core/actions'),
  ),
  closed(
    'session module, native player',
    'playback/plant-native-player.ts',
    importing('connectNativePlayer', '../native/player'),
  ),
  closed(
    'core module, Player builder',
    'core/plant-player-builder.ts',
    importing('unloadPlayerAction', './actions'),
  ),
  closed(
    'core module, native player',
    'core/plant-native-player.ts',
    importing('connectNativePlayer', '../native/player'),
  ),
  // App.tsx itself, so lint only: in the program it would replace the real App.
  closed('App, Player builder', 'App.tsx', importing('unloadPlayerAction', './core/actions'), null),
  closed(
    'screen, native player',
    'screens/HomeScreen.plant-native-player.ts',
    importing('connectNativePlayer', '../native/player'),
  ),
  closed(
    'screen, shell dependencies from the session',
    'screens/HomeScreen.plant-shell-deps.ts',
    importing('shellPlaybackDeps', '../playback/react'),
  ),
  closed(
    'screen, js suffix',
    'screens/HomeScreen.plant-js-suffix.ts',
    importing('CoreContext', '../core/context.js'),
  ),
  closed(
    'screen, static template import',
    'screens/HomeScreen.plant-static-template-import.ts',
    'export const plant = () => import(`../core/actions`);\n',
  ),
  closed(
    'screen, full transport type',
    'screens/HomeScreen.plant-full-transport.ts',
    "import type { CoreTransport } from '../core/transport';\nexport type Plant = CoreTransport;\n",
  ),
  closed(
    'screen, context value type',
    'screens/HomeScreen.plant-context-value.ts',
    "import type { CoreContextValue } from '../core/context';\nexport type Plant = CoreContextValue['transport'];\n",
  ),
  closed(
    'screen, its own Core',
    'screens/HomeScreen.plant-own-core.ts',
    "import { createCoreTransport } from '../core/transport';\nexport const plant = () => createCoreTransport('guest').getState('player');\n",
  ),
  closed(
    'screen, Player builder',
    'screens/HomeScreen.plant-player-builder.ts',
    importing('finalPauseAction', '../core/actions'),
  ),
  closed(
    'screen, dynamic import of the actions',
    'screens/HomeScreen.plant-dynamic-import.ts',
    "export const plant = () => import('../core/actions');\n",
  ),
  closed(
    'player feature, builder alias',
    'player/plant-builder-alias.ts',
    "import { playerAction as report } from '../core/actions';\nexport const ended = () => report('Ended');\n",
  ),
  closed(
    'player feature, namespace import',
    'player/plant-namespace-import.ts',
    "import * as actions from '../core/actions';\nexport const ended = () => actions.playerAction('Ended');\n",
  ),
  closed(
    'player feature, ts suffix',
    'player/plant-ts-suffix.ts',
    "import { finalPauseAction } from '../core/actions.ts';\nexport const save = finalPauseAction;\n",
  ),
  closed(
    'player feature, detour',
    'player/plant-detour.ts',
    "import { unloadPlayerAction } from '../player/../core/actions';\nexport const unload = unloadPlayerAction;\n",
  ),
  closed(
    'player feature, inline type import',
    'player/plant-inline-type.ts',
    "export type Full = import('../core/transport').CoreTransport;\n",
  ),
  closed(
    'updates, native player',
    'updates/plant.ts',
    importing('connectNativePlayer', '../native/player'),
  ),
  closed(
    'component, session internals',
    'components/plant-session-internals.ts',
    importing('savePlayback', '../playback/exit'),
  ),
  closed('core barrel, CoreContext', 'core/index.ts', "export { CoreContext } from './context';\n"),
  closed(
    'component barrel, CoreContext',
    'components/plant-barrel-context.ts',
    "export { CoreContext } from '../core/context';\n",
  ),
  closed(
    'component barrel, full transport',
    'components/plant-barrel-transport.ts',
    "export { createCoreTransport } from '../core/transport';\n",
  ),
  closed(
    'component barrel, native player',
    'components/plant-barrel-native.ts',
    "export { connectNativePlayer } from '../native/player';\n",
  ),
  closed(
    'component barrel, session internals',
    'components/plant-barrel-session.ts',
    "export { savePlayback } from '../playback/exit';\n",
  ),
  closed(
    'component barrel, Player builder',
    'components/plant-barrel-builder.ts',
    "export { loadPlayerAction } from '../core/actions';\n",
  ),
  closed(
    'component barrel, export star',
    'components/plant-barrel-star.ts',
    "export * from '../core/transport';\n",
  ),
  closed(
    'component, import then export',
    'components/plant-reexport.ts',
    "import { CoreContext } from '../core/context';\n\nexport { CoreContext };\n",
  ),
  closed(
    'screen barrel under build/',
    'screens/build/plant.ts',
    "export { CoreContext } from '../../core/context';\n",
  ),
  closed(
    'screen, module augmentation',
    'screens/HomeScreen.plant-augmentation.ts',
    "export {};\n\ndeclare module '../core/transport' {\n  interface PlantAugmentation {\n    plant: true;\n  }\n}\n",
  ),
  closed(
    'screen, test support',
    'screens/HomeScreen.plant-test-support.ts',
    importing('renderWithSettings', '../test/renderWithSettings'),
  ),
  closed(
    'screen, a test file',
    'screens/HomeScreen.plant-test-file.ts',
    "export * from './HomeScreen.rows.test';\n",
  ),
  closed(
    'core module, a test file',
    'core/plant-test-file.ts',
    "export * from './catalog.test';\n",
  ),
  closed(
    'screen, test helpers by name only',
    'screens/plant.test.helpers.ts',
    "export { CoreContext } from '../core/context';\n",
  ),
  plant(
    'screen, nested lint config',
    'screens/build/nested-config/HomeScreen.plant.ts',
    importing('CoreContext', '../../../core/context'),
    boundary,
    'pass',
    'export default [];\n',
  ),
  closed(
    'component, JavaScript',
    'components/plant-script.js',
    importing('createCoreTransport', '../core/transport.ts'),
  ),
  closed(
    'screen, disabled inline',
    'screens/HomeScreen.plant-disable-line.ts',
    "// eslint-disable-next-line kino/import-boundary\nimport { CoreContext } from '../core/context';\nexport const plant = CoreContext;\n",
  ),
  closed(
    'screen, disabled for the file',
    'screens/HomeScreen.plant-disable-file.ts',
    "/* eslint-disable */\nimport { CoreContext } from '../core/context';\nexport const plant = CoreContext;\n",
  ),
];

// Ways past the types in a screen that holds the feature transport. tsc lets each through.
const screen = (name, imports, body, lint) =>
  plant(`screen, ${name}`, at('screen', name), withTransport(imports, body), lint);
const pastTypes = [
  screen(
    'as unknown as',
    '',
    "const full = transport as unknown as { getState: (model: 'player') => Promise<unknown> };\nawait full.getState('player');",
    cast,
  ),
  screen(
    'cast through string',
    "import type { ModelOutsideSession } from '../core/types';",
    "await transport.getState('player' as string as ModelOutsideSession);",
    cast,
  ),
  plant(
    'core module, as never',
    'core/plant-cast.ts',
    'export const plant = (model: string) => model as never;\n',
    cast,
  ),
  screen('as never', '', "await transport.getState('player' as never);", cast),
  screen(
    'cast to an action',
    "import type { DurableAction } from '../core/writes';",
    "await transport.commit({ action: 'Unload' } as DurableAction);",
    cast,
  ),
  screen(
    'cast to a renamed action',
    "import type { DurableAction as Save } from '../core/writes';",
    "await transport.commit({ action: 'Unload' } as Save);",
    cast,
  ),
  screen(
    'cast to a namespaced model name',
    "import type * as types from '../core/types';",
    "const model: string = 'player';\nawait transport.getState(model as types.ModelOutsideSession);",
    cast,
  ),
  screen(
    'cast to an inline action type',
    '',
    "await transport.commit({ action: 'Unload' } as import('../core/writes').DurableAction);",
    cast,
  ),
  screen(
    'cast to a type read off the transport',
    "import type { FeatureTransport } from '../core/transport';",
    "await transport.commit({ action: 'Unload' } as Parameters<FeatureTransport['commit']>[0]);",
    cast,
  ),
  screen(
    'angle-bracket cast to an action',
    "import type { DurableAction } from '../core/writes';",
    "await transport.commit(<DurableAction>{ action: 'Unload' });",
    cast,
  ),
  screen(
    'type predicate to an action',
    "import type { DurableAction } from '../core/writes';",
    "const isSave = (value: object): value is DurableAction => 'action' in value;\nconst unload = { action: 'Unload' };\nif (isSave(unload)) await transport.commit(unload);",
    cast,
  ),
  screen(
    'as any',
    '',
    "await (transport as any).getState('player');",
    '@typescript-eslint/no-explicit-any',
  ),
  screen(
    'looser method type',
    '',
    `const loose: ${looseCommit} = transport;\nawait loose.commit({ action: 'Unload' }, 'player');`,
    '@typescript-eslint/method-signature-style',
  ),
  screen(
    'helper with a looser method parameter',
    `const save = (core: ${looseCommit}) => core.commit({ action: 'Unload' }, 'player');`,
    'await save(transport);',
    '@typescript-eslint/method-signature-style',
  ),
  plant(
    'component, sign-in Core through a looser method type',
    'components/plant-sign-in-core.ts',
    `import { createSignInCore } from '../core/transport';
const core: ${looseCommit} = createSignInCore();
export const plant = () => core.commit({ action: 'Unload' }, 'player');
`,
    '@typescript-eslint/method-signature-style',
  ),
  screen(
    'cast to a model name',
    "import type { ModelOutsideSession } from '../core/types';",
    "const model: string = 'player';\nawait transport.getState(model as ModelOutsideSession);",
    cast,
  ),
  screen(
    'ts-expect-error',
    '',
    "// @ts-expect-error The feature transport takes no Player model.\nawait transport.getState('player');",
    '@typescript-eslint/ban-ts-comment',
  ),
];

// Imports lint cannot resolve, in a screen and in a player feature.
const opaque = (label, name, code) => plant(`${label}, ${name}`, at(label, name), code, syntax);
const opaqueImports = [
  opaque(
    'player feature',
    'computed import',
    "export const plant = () => import(/* @vite-ignore */ ['..', 'core', 'transport'].join('/'));\n",
  ),
  opaque(
    'screen',
    'template import',
    'export const plant = (name: string) => import(/* @vite-ignore */ `../core/${name}`);\n',
  ),
  opaque(
    'player feature',
    'concatenated import',
    "export const plant = () => import(/* @vite-ignore */ '../core/' + 'transport');\n",
  ),
  opaque(
    'player feature',
    'glob import',
    "export const plant = import.meta.glob('../core/transport.ts');\n",
  ),
  opaque(
    'screen',
    'glob import of the native bridge',
    "export const plant = import.meta.glob('../native/*.ts');\n",
  ),
  opaque(
    'player feature',
    'require',
    "declare const require: (id: string) => unknown;\nexport const plant = () => require('../core/transport');\n",
  ),
];

const baselines = [
  plant(
    'baseline, player feature',
    'player/plant-baseline.ts',
    `import { usePlayback } from '../playback';
import { formatTime } from './formatTime';

export const plant = { formatTime, usePlayback };
`,
    'pass',
  ),
  plant(
    'baseline, screen',
    'screens/HomeScreen.plant-baseline.ts',
    withTransport(
      "import { loadBoardAction, logoutAction, unloadAction } from '../core/actions';\nimport type { CoreStateMap } from '../core/types';",
      `await transport.dispatch(loadBoardAction, 'board');
await transport.commit(logoutAction);
await transport.dispatch(unloadAction, 'board');
const board = (await transport.getState('board')) as CoreStateMap['board'] | null;
const names = ['board', 'library'] as const;
await import('../core/catalog');
return { board, names };`,
    ),
    'pass',
  ),
];

export const cases = [
  ...screenTypes,
  ...playerImports,
  ...closedImports,
  ...pastTypes,
  ...opaqueImports,
  ...baselines,
];
