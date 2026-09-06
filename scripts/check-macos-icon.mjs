// Asserts the shipped Kino.icns still sits on the macOS icon grid.
//
// Icon Composer art fills its canvas edge to edge. Handing that straight to
// macOS makes Kino larger than every neighbouring icon in the Dock, which is
// what the icon did before scripts/build-macos-icon.swift existed. This reads
// the committed icns back and checks the shape where Finder expects it, so a
// regenerated or hand-replaced icon cannot quietly go full bleed again.

import { readFileSync } from 'node:fs';

import { decodePng, opaqueBounds } from './test-support/png.mjs';

const ICNS = new URL('../apps/macos-shell/resources/Kino.icns', import.meta.url);

// Every variant Finder and the Dock ask for, keyed by its icns chunk type.
const VARIANTS = {
  ic04: 16,
  ic05: 32,
  ic11: 32,
  ic12: 64,
  ic07: 128,
  ic13: 256,
  ic08: 256,
  ic14: 512,
  ic09: 512,
  ic10: 1024,
};

// macOS draws the icon shape at 824 of a 1024 point canvas. Measured against a
// stock macOS 26 icon, whose opaque shape covers 0.797 of its canvas once the
// shape's own antialiased edge is discounted.
const GRID = 824 / 1024;
const TOLERANCE = 0.02;

function chunks(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'icns') throw new Error('not an icns file');
  const found = new Map();
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8) throw new Error(`chunk ${type} claims ${length} bytes`);
    found.set(type, buffer.subarray(offset + 8, offset + length));
    offset += length;
  }
  return found;
}

const failures = [];
const icns = chunks(readFileSync(ICNS));

for (const [type, size] of Object.entries(VARIANTS)) {
  const png = icns.get(type);
  if (!png) {
    failures.push(`${type} (${size}px) is missing from the icns`);
    continue;
  }
  // iconutil stores the two smallest variants as run length encoded ARGB rather
  // than PNG; their presence is all this gate asserts.
  if (png.toString('binary', 1, 4) !== 'PNG') continue;
  const image = decodePng(png);
  if (image.width !== size || image.height !== size) {
    failures.push(`${type} is ${image.width}x${image.height}, expected ${size}x${size}`);
    continue;
  }
  const box = opaqueBounds(image);
  const covered = box.width / size;
  if (Math.abs(covered - GRID) > TOLERANCE)
    failures.push(
      `${type} (${size}px) covers ${covered.toFixed(3)} of its canvas, expected ${GRID.toFixed(3)}` +
        (covered > 0.97 ? ' — the art is full bleed, not on the macOS grid' : ''),
    );
  const offCentre = Math.max(
    Math.abs(box.left - (size - box.width + 1) / 2),
    Math.abs(box.top - (size - box.height + 1) / 2),
  );
  // An even canvas cannot centre an odd-width shape exactly; half a pixel is
  // the rounding, not a misplaced icon.
  if (offCentre > 0.5 + size * 0.005)
    failures.push(`${type} (${size}px) is off centre by ${offCentre.toFixed(1)}px`);
}

if (failures.length) {
  console.error('Kino.icns does not sit on the macOS icon grid:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nRegenerate it with: pnpm macos:icon');
  process.exit(1);
}

console.log(`Kino.icns carries ${Object.keys(VARIANTS).length} variants on the macOS icon grid.`);
