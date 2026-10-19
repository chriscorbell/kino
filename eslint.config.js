import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

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
    // A spread copies the caller's snapshot of every Kino setting over whatever the store holds
    // now, which undoes a newer change from another screen. The patch type alone allows it.
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'CallExpression[callee.name=/^update(Settings)?$/] > ObjectExpression > SpreadElement',
          "CallExpression[callee.property.name='update'] > ObjectExpression > SpreadElement",
        ].map((selector) => ({
          selector,
          message:
            'Patch only the Kino settings this write changes. A spread writes a stale copy of the others.',
        })),
      ],
    },
  },
);
