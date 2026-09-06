// Asserts the Android TV launcher banner is present, opaque, and drawn.
//
// scripts/build-tv-banner.swift renders the banner through a web view, which
// fails quietly: an SVG loaded the wrong way renders in secure static mode and
// drops the icon it references, leaving a banner that is the right size, the
// right colour, and missing half its artwork. This checks the pixels where the
// mark and the wordmark belong rather than trusting the render.

import { readFileSync } from 'node:fs';

import { decodePng } from './test-support/png.mjs';

const RES = new URL('../apps/android-tv/app/src/main/res/', import.meta.url);

// Google's ladder for a 16:9 banner, 320x180 at xhdpi.
const BUCKETS = [
  ['mipmap-mdpi', 160, 90],
  ['mipmap-hdpi', 240, 135],
  ['mipmap-xhdpi', 320, 180],
  ['mipmap-xxhdpi', 480, 270],
  ['mipmap-xxxhdpi', 640, 360],
];

// Where the lockup sits, as fractions of the banner, from assets/brand/kino-banner.svg.
// The mark's white K is inside the icon tile; the wordmark follows to its right.
const REGIONS = [
  ['the mark', 0.17, 0.3, 0.36, 0.7],
  ['the wordmark', 0.49, 0.38, 0.88, 0.62],
];

const failures = [];

for (const [bucket, width, height] of BUCKETS) {
  const path = new URL(`${bucket}/kino_banner.png`, RES);
  let image;
  try {
    image = decodePng(readFileSync(path));
  } catch (error) {
    failures.push(`${bucket}: ${error.message}`);
    continue;
  }

  if (image.width !== width || image.height !== height) {
    failures.push(`${bucket} is ${image.width}x${image.height}, expected ${width}x${height}`);
    continue;
  }

  // Launchers clip the banner into their own rounded card and paint their own
  // background behind it. A transparent pixel anywhere shows through as a notch.
  let clear = 0;
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) if (image.alpha(x, y) < 255) clear += 1;
  if (clear) failures.push(`${bucket} has ${clear} pixels that are not fully opaque`);

  for (const [what, x0, y0, x1, y1] of REGIONS) {
    let brightest = 0;
    for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y += 1)
      for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x += 1)
        brightest = Math.max(brightest, image.luma(x, y));
    // The lockup is near white on a near black ground, so anything dim here
    // means it did not render.
    if (brightest < 140)
      failures.push(
        `${bucket} is blank where ${what} belongs (brightest pixel ${brightest.toFixed(0)} of 255)`,
      );
  }
}

if (failures.length) {
  console.error('The Android TV banner is not what the launcher needs:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nRegenerate it with: pnpm android:banner');
  process.exit(1);
}

console.log(`The TV banner is opaque and drawn at all ${BUCKETS.length} densities.`);
