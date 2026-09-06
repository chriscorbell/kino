import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withWebEngine } from './test-support/webengine.mjs';

const { build } = await import(createRequire(resolve('apps/desktop/package.json')).resolve('vite'));
const ui = resolve('build/desktop-resume');
await build({
  root: resolve('apps/desktop'),
  configFile: resolve('apps/desktop/vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir: ui,
    emptyOutDir: true,
    rollupOptions: { input: resolve('apps/desktop/src/test/browser/resume.html') },
  },
});
for (const kind of ['movie', 'series']) {
  const entry = `/src/test/browser/resume.html?kind=${kind}`;
  await withWebEngine(ui, entry, async ({ evaluate, key, command, until, origin }) => {
    async function open() {
      await until(
        () =>
          evaluate(
            `document.querySelector('button[aria-label^="Resume Saved"]')?.closest('main')?.hidden === false && window.kinoResumeProbe.playerLoads === 0`,
          ),
        'Continue Watching',
      );
      await evaluate(`
        window.coverFrames = [];
        window.recordCover = true;
        function frame() {
          if (!window.recordCover) return;
          const dialog = document.querySelector('dialog[aria-label="Loading playback"]');
          const style = dialog && getComputedStyle(dialog);
          const rect = dialog?.getBoundingClientRect();
          window.coverFrames.push(Boolean(dialog?.matches(':modal') && dialog.textContent.trim() === '' &&
            style.backgroundColor.startsWith('rgb(') && style.opacity === '1' &&
            rect.x === 0 && rect.y === 0 && rect.width >= innerWidth && rect.height >= innerHeight));
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        document.querySelector('button[aria-label^="Resume Saved"]').click();
      `);
      await until(() => evaluate('window.coverFrames.length >= 3'), 'covered frames');
      assert.ok(
        (await evaluate('window.coverFrames')).every(Boolean),
        'Every frame after the click must have an opaque spinner-only cover',
      );
      await key('Tab', 'Tab', 9);
      assert.equal(
        await evaluate(
          `Boolean(document.activeElement.closest('dialog[aria-label="Loading playback"]'))`,
        ),
        true,
        'Tab must not reach browsing behind the cover',
      );
      await evaluate('window.recordCover = false');
    }
    await open();
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(ui, `resume-${kind}.png`), Buffer.from(screenshot.data, 'base64'));
    await command('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('dialog[aria-label="Loading playback"] span')).animationName`,
      ),
      'none',
      'Reduced motion must stop the spinner animation',
    );
    await command('Emulation.setEmulatedMedia', { features: [] });
    await key('Escape', 'Escape', 27);
    await until(
      () => evaluate(`!document.querySelector('dialog[aria-label="Loading playback"]')`),
      'Escape cancellation',
    );
    const target = `[...document.querySelectorAll('main:not([hidden]) h1')].find(element => !element.closest('[hidden]'))`;
    assert.equal(
      await evaluate(`document.activeElement === ${target}`),
      true,
      'Escape must restore the normal manual-selection focus',
    );
    await evaluate('window.kinoResumeProbe.ready()');
    await until(
      () =>
        evaluate(
          `Boolean(Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Previous source') && !el.disabled))`,
        ),
      'manual sources',
    );
    assert.equal(
      await evaluate('window.kinoResumeProbe.playerLoads'),
      0,
      'Late results must not resume after Escape',
    );

    await command('Page.navigate', { url: origin + entry });
    await open();
    await evaluate('window.kinoResumeProbe.ready()');
    await until(
      () => evaluate('window.kinoResumeProbe.playerLoads === 1'),
      'remembered add-on playback',
    );
    assert.equal(
      await evaluate(`Boolean(document.querySelector('dialog[aria-label="Loading playback"]'))`),
      false,
    );

    await command('Page.navigate', { url: origin + entry });
    await open();
    await evaluate('window.kinoResumeProbe.changeProfile()');
    await until(
      () => evaluate(`!document.querySelector('dialog[aria-label="Loading playback"]')`),
      'profile cancellation',
    );
    await evaluate('window.kinoResumeProbe.ready()');
    assert.equal(await evaluate('window.kinoResumeProbe.playerLoads'), 0);

    await command('Page.navigate', { url: origin + entry });
    await open();
    await evaluate('window.kinoResumeProbe.ready(false)');
    await until(
      () => evaluate(`!document.querySelector('dialog[aria-label="Loading playback"]')`),
      'unavailable remembered source',
    );
    assert.equal(await evaluate('window.kinoResumeProbe.playerLoads'), 0);
    assert.equal(await evaluate(`document.activeElement === ${target}`), true);
  });
}
console.log(
  'Qt WebEngine: movie and series resume cover every frame, preserve Escape focus, reject late/profile results, and start before unrelated add-ons finish.',
);
