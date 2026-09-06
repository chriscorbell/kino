import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { withWebEngine } from './test-support/webengine.mjs';
import { generateTrackFixtures } from './test-support/track-fixtures.mjs';

const { build } = await import(createRequire(resolve('apps/desktop/package.json')).resolve('vite'));
const ui = resolve('build/desktop-tracks');
await build({
  root: resolve('apps/desktop'),
  configFile: resolve('apps/desktop/vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir: ui,
    emptyOutDir: true,
    rollupOptions: { input: resolve('apps/desktop/src/test/browser/tracks.html') },
  },
});
generateTrackFixtures(ui);
await withWebEngine(
  ui,
  '/src/test/browser/tracks.html',
  async ({ evaluate, until }) => {
    await until(() => evaluate('window.kinoTrackProbe?.connected'), 'native track probe');
    await evaluate(
      `for (const [type,id] of [['movie','track-movie'],['series','track-show'],['movie','different-title'],['series','addon-show']]) localStorage.removeItem('kino.tracks.v1:' + JSON.stringify([type,id]));`,
    );
    async function open(
      id,
      episode = 0,
      file = 'two-tracks.mkv',
      language = 'eng',
      enabled = true,
    ) {
      if (!(await evaluate('window.kinoTrackProbe.closed'))) {
        await click('Back to sources');
        await until(() => evaluate('window.kinoTrackProbe.closed'), 'saved playback shutdown');
      }
      await evaluate(
        `window.kinoTrackProbe.open(...${JSON.stringify([id, episode, file, language, enabled])})`,
      );
      try {
        await until(
          () =>
            evaluate(
              'window.kinoTrackProbe.ready && window.kinoTrackProbe.audio.length === 2 && window.kinoTrackProbe.subtitles.length >= 2',
            ),
          'real media tracks',
        );
      } catch (error) {
        console.log({
          id,
          episode,
          file,
          state: await evaluate(
            '({ready:window.kinoTrackProbe.ready,audio:window.kinoTrackProbe.audio,subtitles:window.kinoTrackProbe.subtitles,body:document.body.innerText})',
          ),
        });
        throw error;
      }
    }
    async function click(label) {
      const expression = `Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)})`;
      await until(() => evaluate(`Boolean(${expression})`), label);
      await evaluate(`(${expression}).click()`);
    }
    async function selected(audio, subtitle, external = false) {
      await until(
        () =>
          evaluate(`
      window.kinoTrackProbe.audio.some(t => t.selected && t.lang === ${JSON.stringify(audio)}) &&
      ${subtitle === null ? '!window.kinoTrackProbe.subtitles.some(t => t.selected)' : `window.kinoTrackProbe.subtitles.some(t => t.selected && t.lang === ${JSON.stringify(subtitle)} && t.external === ${external})`}
    `),
        `selected audio ${audio} and subtitle ${subtitle ?? 'off'}`,
      );
    }
    for (const episode of [0, 1]) {
      const id = episode ? 'track-show' : 'track-movie';
      await open(id, episode);
      await selected('eng', 'eng');
      await click('Audio tracks');
      await click('Spanish · AAC');
      await click('Subtitles');
      await click('Spanish · SRT');
      await selected('spa', 'spa');
      await open(id, episode ? 2 : 0, 'replacement-tracks.mkv', 'eng', false);
      await selected('spa', 'spa');
      await open(id, episode ? 3 : 0, 'fallback-tracks.mkv', 'deu');
      await selected('deu', 'deu');
      await open(id, episode ? 4 : 0);
      await selected('spa', 'spa');
      await click('Subtitles');
      await click('Off');
      await selected('spa', null);
      await open(id, episode ? 5 : 0);
      await selected('spa', null);
    }
    await open('different-title');
    await selected('eng', 'eng');
    await open('addon-show', 1);
    await click('Subtitles');
    await click('Spanish');
    await selected('eng', 'spa', true);
    await open('addon-show', 2, 'replacement-tracks.mkv', 'eng', false);
    await selected('eng', 'spa', true);
    assert.equal(await evaluate('window.kinoTrackProbe.audio.filter(t => t.selected).length'), 1);
    console.log(
      'Real mpv track choices survive movie/show reopening and source changes; missing tracks fall back, Off persists, and other titles keep defaults',
    );
  },
  { native: true },
);
