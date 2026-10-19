import assert from 'node:assert/strict';

const moving = `[...new Set([...document.querySelectorAll('*')].flatMap((element) =>
  [null, '::before', '::after', '::backdrop'].flatMap((pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const durations = (style.animationDuration + ',' + style.transitionDuration).split(',');
    return durations.some((duration) => parseFloat(duration) > 0)
      ? [element.localName + [...element.classList].map((name) => '.' + name).join('') + (pseudo ?? '')]
      : [];
  }),
))]`;

// The scan has to find motion before reduced motion is requested, or finding none afterwards
// proves nothing.
export async function assertStillWithReducedMotion({ command, evaluate }, screen) {
  assert.notDeepEqual(await evaluate(moving), [], `${screen}: the scan must see the page's motion`);
  await command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  try {
    assert.deepEqual(
      await evaluate(moving),
      [],
      `${screen}: with reduced motion these still animate, so the rule in global.css is missing or outranked`,
    );
  } finally {
    await command('Emulation.setEmulatedMedia', { features: [] });
  }
}
