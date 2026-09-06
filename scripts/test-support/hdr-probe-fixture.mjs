// Builds the HDR probe fixture the Shield sampler measurement reads back.
//
// This is not ordinary media. Every pixel is a known ten-bit code word, encoded
// losslessly, so a value read out of the GPU has an exact expected counterpart
// rather than an approximate one. testsrc2 cannot serve here: its colours clip
// far out of gamut once tagged BT.2020, which hides the very differences the
// measurement is looking for.
//
// The four bands each answer one question:
//   A  a neutral ramp across the legal luma range. Neutral chroma gives R=G=B
//      under every candidate matrix, so this isolates the transfer function.
//   B  chroma pairs the BT.2020, BT.709 and BT.601 matrices disagree about by
//      far more than any rounding, which identifies which one the driver used.
//   C  sixteen steps one code apart. An eight-bit path collapses these.
//   D  the same span four codes apart, which survives eight bits and so proves
//      the readback works when precision alone is not the limit.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WIDTH = 640;
const HEIGHT = 360;
const FRAMES = 24;

// Limited range, ten bit: luma 64..940, chroma 64..960 centred on 512.
export const BAND_A_LUMA = Array.from(
  { length: 16 },
  (_, i) => 64 + Math.round((i * (940 - 64)) / 15),
);
export const BAND_B_CHROMA = [
  [512, 960],
  [512, 64],
  [960, 512],
  [64, 512],
  [800, 300],
  [300, 800],
  [700, 700],
  [200, 200],
];
export const BAND_C_LUMA = Array.from({ length: 16 }, (_, i) => 500 + i);
export const BAND_D_LUMA = Array.from({ length: 16 }, (_, i) => 500 + 4 * i);

function frame() {
  const luma = new Uint16Array(WIDTH * HEIGHT);
  const cb = new Uint16Array((WIDTH / 2) * (HEIGHT / 2)).fill(512);
  const cr = new Uint16Array((WIDTH / 2) * (HEIGHT / 2)).fill(512);

  const patch = (x) => Math.min(15, Math.floor((x * 16) / WIDTH));
  for (let y = 0; y < HEIGHT; y += 1) {
    const band = y < 90 ? BAND_A_LUMA : y < 180 ? null : y < 270 ? BAND_C_LUMA : BAND_D_LUMA;
    for (let x = 0; x < WIDTH; x += 1) {
      luma[y * WIDTH + x] = band ? band[patch(x)] : 500;
    }
  }
  for (let y = 45; y < 90; y += 1) {
    for (let x = 0; x < WIDTH / 2; x += 1) {
      const [b, r] = BAND_B_CHROMA[Math.min(7, Math.floor((x * 8) / (WIDTH / 2)))];
      cb[y * (WIDTH / 2) + x] = b;
      cr[y * (WIDTH / 2) + x] = r;
    }
  }

  const bytes = Buffer.alloc((luma.length + cb.length + cr.length) * 2);
  let offset = 0;
  for (const plane of [luma, cb, cr]) {
    for (const value of plane) {
      bytes.writeUInt16LE(value, offset);
      offset += 2;
    }
  }
  return bytes;
}

export function generateHdrProbe(fixturesDir) {
  const target = join(fixturesDir, 'hdr-probe.mkv');
  if (existsSync(target)) return target;
  mkdirSync(fixturesDir, { recursive: true });
  const raw = join(fixturesDir, 'hdr-probe.yuv');
  writeFileSync(raw, Buffer.concat(Array.from({ length: FRAMES }, frame)));

  // lossless=1 is the point: the code words written above must be the code words
  // the decoder returns, or the measurement compares against the wrong numbers.
  // setparams tags the frames before x265 sees them; without it the container
  // records an unknown transfer and the decoder never learns the stream is PQ.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'yuv420p10le',
      '-s',
      `${WIDTH}x${HEIGHT}`,
      '-r',
      '24',
      '-i',
      raw,
      '-vf',
      'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv',
      '-c:v',
      'libx265',
      '-preset',
      'ultrafast',
      '-x265-params',
      'lossless=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:hdr10=1:' +
        'master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1)',
      '-pix_fmt',
      'yuv420p10le',
      '-color_primaries',
      'bt2020',
      '-color_trc',
      'smpte2084',
      '-colorspace',
      'bt2020nc',
      '-color_range',
      'tv',
      target,
    ],
    { stdio: 'inherit' },
  );

  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=color_transfer,color_primaries,pix_fmt',
      '-of',
      'json',
      target,
    ]).toString(),
  ).streams[0];
  if (probe.color_transfer !== 'smpte2084' || probe.color_primaries !== 'bt2020')
    throw new Error(`hdr-probe.mkv lost its HDR tags: ${JSON.stringify(probe)}`);
  if (probe.pix_fmt !== 'yuv420p10le')
    throw new Error(`hdr-probe.mkv is not ten bit: ${probe.pix_fmt}`);
  return target;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2];
  if (!dir)
    throw new Error('Usage: node scripts/test-support/hdr-probe-fixture.mjs <fixtures dir>');
  console.log(`Generated ${generateHdrProbe(dir)}`);
}
