// Asserts the shipped Kino.ico carries every size Windows asks for, on its grid,
// and, given a built Kino.exe, that the executable carries exactly that icon
// under the name Qt gives its windows.
//
//   node scripts/check-windows-icon.mjs            the committed Kino.ico
//   node scripts/check-windows-icon.mjs Kino.exe   and the icon Kino.exe embeds

import { readFileSync } from 'node:fs';

import { peResources, RT_GROUP_ICON, RT_ICON } from './test-support/pe.mjs';
import { decodePng, opaqueBounds } from './test-support/png.mjs';

const ICO = new URL('../apps/macos-shell/resources/Kino.ico', import.meta.url);

// The target sizes Microsoft lists for Windows 11's taskbar, Start, title bars
// and context menus at every scale factor.
const SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

// Windows lays icons out on a 48 pixel grid; the shape keeps 2 of them clear on
// each side, snapped to whole pixels at every size.
const margin = (size) => Math.round((size * 2) / 48);

function images(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('not an .ico file');
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    return { size: ico[at] || 256, data: ico.subarray(offset, offset + length) };
  });
}

const failures = [];
const ico = images(readFileSync(ICO));

const present = ico.map((image) => image.size);
for (const size of SIZES)
  if (!present.includes(size)) failures.push(`${size}px is missing from Kino.ico`);

for (const { size, data } of ico) {
  const image = decodePng(data);
  if (image.width !== size || image.height !== size) {
    failures.push(`the ${size}px entry is ${image.width}x${image.height}`);
    continue;
  }
  // The art's antialiased edge reaches half a pixel either way at small sizes.
  const box = opaqueBounds(image, 128);
  const expected = size - 2 * margin(size);
  if (Math.abs(box.width - expected) > 1 || Math.abs(box.height - expected) > 1)
    failures.push(`${size}px draws a ${box.width}x${box.height} shape, expected ${expected}`);
  if (Math.abs(box.left - margin(size)) > 1 || Math.abs(box.top - margin(size)) > 1)
    failures.push(`${size}px starts its shape at ${box.left},${box.top}, expected ${margin(size)}`);
}

const exe = process.argv[2];
if (exe) {
  const resources = peResources(readFileSync(exe));
  // rc names the group after the .rc file's identifier, and Qt looks it up by
  // that string, so a numeric id would leave every window without an icon.
  const group = resources.find((r) => r.type === RT_GROUP_ICON && r.name === 'IDI_ICON1');
  if (!group) failures.push(`${exe} has no IDI_ICON1 icon group`);
  else {
    const count = group.data.readUInt16LE(4);
    if (count !== ico.length)
      failures.push(`IDI_ICON1 holds ${count} images, Kino.ico ${ico.length}`);
    for (let i = 0; i < Math.min(count, ico.length); i += 1) {
      const id = group.data.readUInt16LE(6 + 14 * i + 12);
      const icon = resources.find((r) => r.type === RT_ICON && r.name === id);
      if (!icon?.data.equals(ico[i].data))
        failures.push(`${exe}'s ${ico[i].size}px icon differs from Kino.ico`);
    }
  }
}

if (failures.length) {
  console.error('Kino.ico is not what Windows should show:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nRegenerate it with: pnpm windows:icon');
  process.exit(1);
}

console.log(
  `Kino.ico carries ${ico.length} sizes on the Windows icon grid` +
    (exe ? `, and ${exe} embeds it as IDI_ICON1.` : '.'),
);
