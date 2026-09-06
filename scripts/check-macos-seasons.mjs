import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withWebEngine } from './test-support/webengine.mjs';

const { build } = await import(createRequire(resolve('apps/desktop/package.json')).resolve('vite'));
const ui = resolve('build/desktop-seasons');
await build({
  root: resolve('apps/desktop'),
  configFile: resolve('apps/desktop/vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir: ui,
    emptyOutDir: true,
    rollupOptions: { input: resolve('apps/desktop/src/test/browser/seasons.html') },
  },
});
await withWebEngine(
  ui,
  '/src/test/browser/seasons.html',
  async ({ evaluate, key, until, command }) => {
    const selector = `document.querySelector('select')`;
    const visibleMain = `document.querySelector('main:not([hidden])')`;
    const clickText = async (text) =>
      evaluate(
        `[...document.querySelectorAll('button')].find(element => !element.closest('[hidden]') && element.textContent.trim() === ${JSON.stringify(text)})?.click()`,
      );
    await until(
      () =>
        evaluate(
          `Boolean([...document.querySelectorAll('button')].find(element => element.textContent.includes('Season fixture')))`,
        ),
      'fixture poster',
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(element => element.textContent.includes('Season fixture')).click()`,
    );
    await until(() => evaluate(`${selector}?.value === '2'`), 'progress-selected season');
    assert.deepEqual(await evaluate('window.kinoSeasonsProbe.requests'), []);
    await evaluate(
      `${selector}.value = '1'; ${selector}.dispatchEvent(new Event('change', {bubbles: true}))`,
    );
    await until(() => evaluate(`${selector}.value === '1'`), 'season choice');
    await evaluate('window.kinoSeasonsProbe.lateProgress()');
    assert.equal(
      await evaluate(`${selector}.value`),
      '1',
      'Late progress cannot replace a manual season',
    );
    assert.deepEqual(await evaluate('window.kinoSeasonsProbe.requests'), []);
    await evaluate(
      `window.episode = document.querySelector('[data-episode-id="show:1:18"]'); window.episode.scrollIntoView({block: 'center'}); window.episode.focus(); window.savedScroll = ${visibleMain}.scrollTop; window.episode.click()`,
    );
    await until(
      () => evaluate(`window.kinoSeasonsProbe.requests.at(-1) === 'show:1:18'`),
      'explicit episode source request',
    );
    assert.equal(
      await evaluate(`${visibleMain}.scrollTop`),
      0,
      'The source page starts at its header',
    );
    assert.equal(await evaluate(`document.activeElement.tagName`), 'H1');
    assert.equal(await evaluate(`Boolean(document.querySelector('dialog'))`), false);
    await evaluate(`window.kinoSeasonsProbe.ready('show:1:17')`);
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].some(element => !element.closest('[hidden]') && !element.disabled && element.textContent.includes('Source for show:1:17'))`,
      ),
      false,
      'An out-of-order source cannot be selected',
    );
    await evaluate('window.kinoSeasonsProbe.fail()');
    await clickText('Back');
    await until(
      () => evaluate(`document.activeElement.dataset.episodeId === 'show:1:18'`),
      'focused episode after failure and Back',
    );
    assert.equal(
      await evaluate(`${visibleMain}.scrollTop === window.savedScroll`),
      true,
      'Back restores the episode scroll position',
    );
    await key('Enter', 'Enter', 13);
    await until(() => evaluate(`document.activeElement.tagName === 'H1'`), 'reopened sources');
    await evaluate('window.kinoSeasonsProbe.ready()');
    await until(
      () =>
        evaluate(
          `[...document.querySelectorAll('button')].some(element => !element.disabled && element.textContent.includes('Source for show:1:18'))`,
        ),
      'current sources',
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(element => !element.disabled && element.textContent.includes('Source for show:1:18')).click()`,
    );
    await until(() => evaluate('window.kinoSeasonsProbe.playerLoads === 1'), 'player preparation');
    await clickText('Back to sources');
    await until(
      () => evaluate(`document.activeElement.tagName === 'H1'`),
      'sources after player exit',
    );
    await clickText('Back');
    await until(
      () => evaluate(`document.activeElement.dataset.episodeId === 'show:1:18'`),
      'episode focus after player exit',
    );
    assert.equal(await evaluate(`${selector}.value`), '1');
    assert.equal(await evaluate(`${visibleMain}.scrollTop === window.savedScroll`), true);
    await command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 650,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(ui, 'series.png'), Buffer.from(screenshot.data, 'base64'));
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
      true,
      'Long episode titles must fit a narrow window',
    );
    await evaluate(
      `${selector}.value = '4'; ${selector}.dispatchEvent(new Event('change', { bubbles: true }))`,
    );
    await until(
      () => evaluate(`${selector}.value === '4'`),
      'guest season before switching profiles',
    );
    await evaluate('window.kinoSeasonsProbe.changeProfile()');
    await until(() => evaluate(`${selector}?.value === '1'`), 'fresh account season');
    assert.equal(
      await evaluate(
        `document.querySelector('[data-episode-id="show:1:18"]')?.textContent.includes('Watched')`,
      ),
      false,
    );
    console.log(
      'Qt WebEngine: season-only browsing, stale-source rejection, Back focus/scroll, player return, profile isolation, and narrow layout passed.',
    );
  },
);
