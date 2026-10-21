import assert from 'node:assert/strict';

const pseudoElements = [
  '::before',
  '::after',
  '::backdrop',
  '::marker',
  '::placeholder',
  '::file-selector-button',
  '::-webkit-scrollbar',
  '::-webkit-scrollbar-track',
  '::-webkit-scrollbar-thumb',
];
const moving = `[...new Set([...document.querySelectorAll('*')].flatMap((element) =>
  [null, ...${JSON.stringify(pseudoElements)}].flatMap((pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const durations = (style.animationDuration + ',' + style.transitionDuration).split(',');
    return durations.some((duration) => parseFloat(duration) > 0)
      ? [element.localName + [...element.classList].map((name) => '.' + name).join('') + (pseudo ?? '')]
      : [];
  }),
))]`;

// The scan has to find motion when reduced motion is not requested, or finding none afterwards
// proves nothing. CI machines can request it system-wide (GitHub's macOS image turns on Reduce
// motion), so both scans pin the preference rather than inherit it from the OS.
export async function assertStillWithReducedMotion({ command, evaluate }, screen) {
  const scan = async (value) => {
    await command('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    });
    return evaluate(moving);
  };
  try {
    assert.notDeepEqual(
      await scan('no-preference'),
      [],
      `${screen}: the scan must see the page's motion`,
    );
    assert.deepEqual(
      await scan('reduce'),
      [],
      `${screen}: with reduced motion these still animate, so the rule in global.css is missing or outranked`,
    );
  } finally {
    await command('Emulation.setEmulatedMedia', { features: [] });
  }
}
