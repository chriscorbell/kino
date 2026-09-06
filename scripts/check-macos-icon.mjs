// Asserts the shipped Kino.icns still sits on the macOS icon grid.
//
// Icon Composer art fills its canvas edge to edge. Handing that straight to
// macOS makes Kino larger than every neighbouring icon in the Dock, which is
// what the icon did before scripts/build-macos-icon.swift existed. This reads
// the committed icns back and checks the shape where Finder expects it, so a
// regenerated or hand-replaced icon cannot quietly go full bleed again.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

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

// Enough of a PNG decoder to read the alpha channel of what CoreGraphics wrote:
// 8 bit RGBA, no interlacing, which is all CGImageDestination produces here.
// iconutil stores the two smallest variants as run length encoded ARGB instead,
// which this returns null for; their presence is all this gate asserts.
function alpha(png) {
  if (png.toString('binary', 1, 4) !== 'PNG') return null;
  let idat = [];
  let width, height;
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error('expected a non-interlaced 8 bit RGBA PNG');
    } else if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(width * height);
  let previous = Buffer.alloc(stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = Buffer.from(raw.subarray(read, read + stride));
    read += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < width; x += 1) out[y * width + x] = line[x * 4 + 3];
    previous = line;
  }
  return { width, height, out };
}

// The opaque shape, ignoring the drop shadow that fades out around it.
function shape({ width, height, out }) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (out[y * width + x] >= 250) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) throw new Error('variant is fully transparent');
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

const failures = [];
const icns = chunks(readFileSync(ICNS));

for (const [type, size] of Object.entries(VARIANTS)) {
  const png = icns.get(type);
  if (!png) {
    failures.push(`${type} (${size}px) is missing from the icns`);
    continue;
  }
  const image = alpha(png);
  if (!image) continue;
  if (image.width !== size || image.height !== size) {
    failures.push(`${type} is ${image.width}x${image.height}, expected ${size}x${size}`);
    continue;
  }
  const box = shape(image);
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
