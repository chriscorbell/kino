import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertStillWithReducedMotion } from './test-support/reduced-motion.mjs';
import { withWebEngine } from './test-support/webengine.mjs';

const focus = `(() => { const el = document.activeElement; return { tag: el.tagName, label: el.textContent.trim(), outline: getComputedStyle(el).outlineStyle }; })()`;
const ui = resolve('apps/desktop/dist');
await withWebEngine(ui, '/', async ({ evaluate, key, command, until }) => {
  await until(() => evaluate(`document.activeElement?.tagName === 'MAIN'`), 'Home focus');
  assert.equal(
    (await evaluate(focus)).outline,
    'none',
    'Cold launch must not outline the content region',
  );
  await assertStillWithReducedMotion({ command, evaluate }, 'Home');
  await evaluate(`document.querySelector('button[aria-label="Settings"]').focus()`);
  await key('Enter', 'Enter', 13);
  await until(() => evaluate(`document.activeElement?.tagName === 'H1'`), 'Settings heading focus');
  assert.equal((await evaluate(focus)).outline, 'none', 'Navigation must not outline the heading');
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('main h2, main label, main button')).some(el => /^(Torrent streaming|Seeding|Download limit)$/.test(el.textContent.trim()))`,
    ),
    false,
    'Settings must not offer torrent configuration',
  );
  await assertStillWithReducedMotion({ command, evaluate }, 'Settings');
  await key('Tab', 'Tab', 9);
  assert.equal((await evaluate(focus)).outline, 'solid', 'Tab must visibly focus a control');
  await evaluate(`document.querySelector('a[href="#main-content"]').focus()`);
  await key('Enter', 'Enter', 13);
  assert.equal((await evaluate(focus)).tag, 'MAIN');
  assert.equal(
    (await evaluate(focus)).outline,
    'solid',
    'Skip to content must visibly focus the region',
  );
  await key('Tab', 'Tab', 9);
  assert.equal(
    (await evaluate(focus)).outline,
    'solid',
    'Controls retain visible focus after skipping',
  );
  // A deliberate keyboard entry must regain the ring after the automatic focus ends.
  await evaluate(
    `document.querySelector('main').tabIndex = 0; document.querySelector('a[href="#main-content"]').focus()`,
  );
  await key('Enter', 'Enter', 13);
  await key('Tab', 'Tab', 9);
  await key('Tab', 'Tab', 9, 8);
  assert.equal((await evaluate(focus)).tag, 'MAIN');
  assert.equal(
    (await evaluate(focus)).outline,
    'solid',
    'Tabbing back into the region must retain its ring',
  );
  console.log(
    'Qt WebEngine: launch and navigation focus have no outline; Tab and Skip to content retain visible focus; reduced motion stops every animation and transition on Home and Settings.',
  );
});

const { build } = await import(
  pathToFileURL(createRequire(resolve('apps/desktop/package.json')).resolve('vite')).href
);
const fixture = resolve('build/desktop-focus');
await build({
  root: resolve('apps/desktop'),
  configFile: resolve('apps/desktop/vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir: fixture,
    emptyOutDir: true,
    rollupOptions: { input: resolve('apps/desktop/src/test/browser/focus.html') },
  },
});
await withWebEngine(
  fixture,
  '/src/test/browser/focus.html',
  async ({ evaluate, key, command, until }) => {
    // What assistive technology reads from the focused element: Chromium's own accessibility tree.
    const focused = async () => {
      const { result } = await command('Runtime.evaluate', {
        expression: 'document.activeElement',
      });
      const { node } = await command('DOM.describeNode', { objectId: result.objectId });
      const { nodes } = await command('Accessibility.getPartialAXTree', {
        backendNodeId: node.backendNodeId,
        fetchRelatives: false,
      });
      return {
        role: nodes[0].role?.value,
        name: nodes[0].name?.value.trim(),
        value: nodes[0].value?.value,
      };
    };
    const tabTo = async (name) => {
      const visited = [];
      for (let presses = 0; presses < 30; presses++) {
        await key('Tab', 'Tab', 9);
        const control = await focused();
        if (control.name === name) return control;
        visited.push(`${control.role} "${control.name}"`);
      }
      assert.fail(`Tab never reached "${name}". It visited ${visited.join(', ')}`);
    };
    const account = 'Stremio account';

    await until(
      () => evaluate(`Boolean(document.querySelector('[aria-label="Discover"]'))`),
      'navigation',
    );
    await evaluate(`document.querySelector('[aria-label="Discover"]').focus()`);
    await key('Enter', 'Enter', 13);
    await until(
      () =>
        evaluate(
          `document.activeElement?.tagName === 'H1' && document.activeElement.textContent === 'Discover'`,
        ),
      'Discover heading focus',
    );
    await until(() => evaluate('window.kinoFocusProbe.genreLoads.length > 0'), 'Discover catalog');
    const genre = await tabTo('Genre');
    assert.deepEqual(
      genre,
      { role: 'combobox', name: 'Genre', value: 'All Genres' },
      'Genre is a named selection control',
    );
    await key('d', 'KeyD', 68);
    await until(
      () => evaluate(`window.kinoFocusProbe.genreLoads.at(-1) === 'Drama'`),
      'Drama catalog after typing',
    );
    assert.equal((await focused()).value, 'Drama', 'The genre control reads the chosen genre');

    for (const width of [720, 500, 320]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await until(() => evaluate(`innerWidth === ${width}`), `${width} px viewport`);
      assert.equal(
        await evaluate(`(() => {
        const control = document.querySelector('[aria-label="${account}"]');
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.width > 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && control.contains(hit);
      })()`),
        true,
        `Account access is visible and unclipped at ${width} px`,
      );
      await evaluate(`document.querySelector('a[href="#main-content"]').focus()`);
      await tabTo(account);
      await key('Enter', 'Enter', 13);
      await until(
        () => evaluate(`document.querySelector('dialog h1')?.textContent === '${account}'`),
        `account dialog at ${width} px`,
      );
      assert.match(
        await evaluate(`document.querySelector('dialog').textContent`),
        /viewer@example\.invalid/,
      );
      await tabTo('Sign out');
      await key('Escape', 'Escape', 27);
      await until(
        async () => (await focused()).name === account,
        `account control focus after closing at ${width} px`,
      );
    }
    await key('Enter', 'Enter', 13);
    await tabTo('Sign out');
    await key('Enter', 'Enter', 13);
    await until(
      async () => (await focused()).name === 'Sign in with Stremio',
      'sign-in control after signing out',
    );
    await key('Enter', 'Enter', 13);
    await until(async () => (await focused()).name === 'Email', 'sign-in form');
    console.log(
      'Qt WebEngine: the Discover genre selector is a named combobox that Tab reaches and typing changes; account information, sign-out and sign-in stay visible and keyboard-reachable at 720, 500 and 320 px.',
    );
  },
);
