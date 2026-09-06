import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { withWebEngine } from './test-support/webengine.mjs';

const focus = `(() => { const el = document.activeElement; return { tag: el.tagName, label: el.textContent.trim(), outline: getComputedStyle(el).outlineStyle }; })()`;
await withWebEngine(resolve('apps/desktop/dist'), '/', async ({ evaluate, key, until }) => {
  await until(() => evaluate(`document.activeElement?.tagName === 'MAIN'`), 'Home focus');
  assert.equal(
    (await evaluate(focus)).outline,
    'none',
    'Cold launch must not outline the content region',
  );
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
    'Qt WebEngine: launch and navigation focus have no outline; Tab and Skip to content retain visible focus.',
  );
});
