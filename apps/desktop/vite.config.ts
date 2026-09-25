import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Kino's version lives in the root package.json, shared with the native shell
// and the TV app.
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __KINO_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
