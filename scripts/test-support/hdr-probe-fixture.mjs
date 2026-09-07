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

import { samplerOutput, toneMapPixel } from './tone-map-reference.mjs';

const WIDTH = 640;
const HEIGHT = 360;
const FRAMES = 24;

// Limited range, ten bit: luma 64..940, chroma 64..960 centred on 512.
export const BAND_A_LUMA = Array.from(
  { length: 16 },
  (_, i) => 64 + Math.round((i * (940 - 64)) / 15),
);
// Band B is deliberately two things at once. The first four pairs are extreme, so they
// identify which matrix the driver applied before any tone curve can hide it. The last four
// are moderate, so the gamut conversion is actually exercised: a neutral patch is neutral
// under every matrix and would let a wrong one through unnoticed.
export const BAND_B_CHROMA = [
  [512, 960],
  [512, 64],
  [960, 512],
  [64, 512],
  [420, 490],
  [420, 500],
  [420, 510],
  [420, 520],
];
/**
 * The in-gamut half, which the tone mapping gate checks against expected colour.
 *
 * These four are chosen for conditioning as much as for saturation. After the BT.2020 to BT.709
 * matrix a channel is a difference of larger terms, so a saturated colour near the gamut edge
 * amplifies the driver's own small deviation into tenths, which would make the gate flaky rather
 * than strict. Each of these moves by about 0.018 under the driver's measured error but by about
 * 0.15 if the gamut conversion is dropped, four times the gate's tolerance.
 *
 * They share a hue because that is where the well-conditioned, in-gamut region is. BT.2020 colour
 * that both survives conversion to BT.709 without clipping and does not amplify input error sits in
 * a narrow band; the four sweep saturation across it rather than hue around it.
 */
export const BAND_B_IN_GAMUT = [4, 5, 6, 7];
const BAND_B_LUMA = 560;
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
      luma[y * WIDTH + x] = band ? band[patch(x)] : BAND_B_LUMA;
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

/**
 * The patches the device gate reads back, with what the pipeline should produce for each.
 *
 * The neutral bands plus band B's in-gamut half. Neutral patches say nothing about the gamut
 * matrix, since neutral is neutral under all of them, so the coloured patches are what make a
 * wrong matrix fail here.
 */
export function expectedToneMappedPatches() {
  const patches = [];
  const add = (band, x, y, luma) => {
    const sampled = samplerOutput(luma, 512, 512);
    patches.push({
      band,
      x,
      y,
      luma,
      // What the driver should hand the shader, still PQ encoded.
      sampled: sampled.map((v) => Number(v.toFixed(6))),
      expected: toneMapPixel(sampled).map((v) => Number(v.toFixed(6))),
    });
  };
  BAND_A_LUMA.forEach((luma, i) => add('A', i * 40 + 20, 45, luma));
  for (const i of BAND_B_IN_GAMUT) {
    const [cb, cr] = BAND_B_CHROMA[i];
    const sampled = samplerOutput(BAND_B_LUMA, cb, cr);
    patches.push({
      band: 'B',
      x: i * 80 + 40,
      y: 135,
      luma: BAND_B_LUMA,
      cb,
      cr,
      sampled: sampled.map((v) => Number(v.toFixed(6))),
      expected: toneMapPixel(sampled).map((v) => Number(v.toFixed(6))),
    });
  }
  BAND_C_LUMA.forEach((luma, i) => add('C', i * 40 + 20, 225, luma));
  BAND_D_LUMA.forEach((luma, i) => add('D', i * 40 + 20, 315, luma));
  return patches;
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

  // The gate compares the GPU's output against these. They are computed here, on the host, in a
  // different language from the shader, so an error in the pipeline has to be made twice to pass.
  writeFileSync(
    join(fixturesDir, 'hdr-probe-expected.json'),
    JSON.stringify(
      {
        sourcePeakNits: 1000,
        targetPeakNits: 203,
        patches: expectedToneMappedPatches(),
      },
      null,
      2,
    ),
  );
  return target;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2];
  if (!dir)
    throw new Error('Usage: node scripts/test-support/hdr-probe-fixture.mjs <fixtures dir>');
  console.log(`Generated ${generateHdrProbe(dir)}`);
}
