import assert from 'node:assert/strict';

// Every element and pseudo-element on the page whose animation or transition takes time.
const moving = `[...new Set([...document.querySelectorAll('*')].flatMap((element) =>
  [null, '::before', '::after', '::backdrop'].flatMap((pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const durations = (style.animationDuration + ',' + style.transitionDuration).split(',');
    return durations.some((duration) => parseFloat(duration) > 0)
      ? [element.localName + [...element.classList].map((name) => '.' + name).join('') + (pseudo ?? '')]
      : [];
  }),
))]`;

// The scan covers whatever the page holds, so an animation nobody listed is still caught. It has
// to find motion before reduced motion is requested, or finding none afterwards proves nothing.
export async function assertStillWithReducedMotion({ command, evaluate }, screen) {
  assert.notDeepEqual(await evaluate(moving), [], `${screen}: the scan must see the page's motion`);
  await command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  try {
    assert.deepEqual(
      await evaluate(moving),
      [],
      `${screen}: with reduced motion these still animate; something outranks the rule in global.css`,
    );
  } finally {
    await command('Emulation.setEmulatedMedia', { features: [] });
  }
}
