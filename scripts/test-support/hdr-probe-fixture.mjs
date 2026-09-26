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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
export function expectedToneMappedPatches({ transfer = 'pq' } = {}) {
  const patches = [];
  const add = (band, x, y, luma) => {
    const sampled = samplerOutput(luma, 512, 512);
    patches.push({
      band,
      x,
      y,
      luma,
      // What the driver should hand the shader, still PQ or HLG encoded.
      sampled: sampled.map((v) => Number(v.toFixed(6))),
      expected: toneMapPixel(sampled, { transfer }).map((v) => Number(v.toFixed(6))),
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
      expected: toneMapPixel(sampled, { transfer }).map((v) => Number(v.toFixed(6))),
    });
  }
  BAND_C_LUMA.forEach((luma, i) => add('C', i * 40 + 20, 225, luma));
  BAND_D_LUMA.forEach((luma, i) => add('D', i * 40 + 20, 315, luma));
  return patches;
}

/**
 * The probe as HDR10, or with `transfer: 'hlg'` as HLG: the same code words under the other
 * transfer, so both reach the same layout of expected patches.
 */
export function generateHdrProbe(fixturesDir, { transfer = 'pq' } = {}) {
  const hlg = transfer === 'hlg';
  const name = hlg ? 'hlg-probe' : 'hdr-probe';
  const trc = hlg ? 'arib-std-b67' : 'smpte2084';
  const target = join(fixturesDir, `${name}.mkv`);
  if (existsSync(target)) return target;
  mkdirSync(fixturesDir, { recursive: true });
  const raw = join(fixturesDir, `${name}.yuv`);
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
      `setparams=color_primaries=bt2020:color_trc=${trc}:colorspace=bt2020nc:range=tv`,
      '-c:v',
      'libx265',
      '-preset',
      'ultrafast',
      '-x265-params',
      `lossless=1:colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc:range=limited` +
        // HLG carries no mastering metadata: its display is defined by the standard.
        (hlg
          ? ''
          : ':hdr10=1:master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)' +
            'L(10000000,1)'),
      '-pix_fmt',
      'yuv420p10le',
      '-color_primaries',
      'bt2020',
      '-color_trc',
      trc,
      '-colorspace',
      'bt2020nc',
      '-color_range',
      'tv',
      target,
    ],
    { stdio: 'inherit' },
  );
  // The encoded file holds the same code words; the raw frames would only ride along into the
  // test APK, which bundles this directory.
  rmSync(raw);

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
  if (probe.color_transfer !== trc || probe.color_primaries !== 'bt2020')
    throw new Error(`${name}.mkv lost its HDR tags: ${JSON.stringify(probe)}`);
  if (probe.pix_fmt !== 'yuv420p10le')
    throw new Error(`${name}.mkv is not ten bit: ${probe.pix_fmt}`);

  // The gate compares the GPU's output against these. They are computed here, on the host, in a
  // different language from the shader, so an error in the pipeline has to be made twice to pass.
  writeFileSync(
    join(fixturesDir, `${name}-expected.json`),
    JSON.stringify(
      {
        transfer,
        sourcePeakNits: 1000,
        targetPeakNits: 203,
        patches: expectedToneMappedPatches({ transfer }),
      },
      null,
      2,
    ),
  );
  return target;
}

const videoProfile = (path) =>
  execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,profile',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split(/\s+/)
    .join(' ');

/**
 * The SDR control for the pixel gate: band A's layout as an eight-bit BT.709 neutral ramp from
 * black to white, lossless. It asks nothing about tone mapping, only whether a drawn frame can be
 * read back at all, so a failure in the HDR patches means the HDR path and not the capture.
 */
export function generateSdrProbe(fixturesDir) {
  const target = join(fixturesDir, 'sdr-probe.mkv');
  // Plain 4:2:0 H.264, which every hardware decoder takes. The ramp only has to read back in
  // order, so it need not be lossless, and lossless H.264 is the High 4:4:4 Predictive profile,
  // which VideoToolbox decodes but D3D11VA and NVDEC do not. An older lossless copy is made again.
  if (existsSync(target) && /^h264 (?!High 4:4:4)/.test(videoProfile(target))) return target;
  mkdirSync(fixturesDir, { recursive: true });
  const luma = Buffer.alloc(WIDTH * HEIGHT, 126);
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128);
  for (let y = 0; y < 90; y += 1)
    for (let x = 0; x < WIDTH; x += 1)
      luma[y * WIDTH + x] =
        16 + Math.round((Math.min(15, Math.floor((x * 16) / WIDTH)) * 219) / 15);
  const raw = join(fixturesDir, 'sdr-probe.yuv');
  writeFileSync(
    raw,
    Buffer.concat(Array.from({ length: FRAMES }, () => Buffer.concat([luma, chroma]))),
  );
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'yuv420p',
      '-s',
      `${WIDTH}x${HEIGHT}`,
      '-r',
      '24',
      '-i',
      raw,
      '-c:v',
      'libx264',
      '-crf',
      '12',
      '-preset',
      'ultrafast',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-color_range',
      'tv',
      target,
    ],
    { stdio: 'inherit' },
  );
  // The encoded file holds the same code words; the raw frames would only ride along into the
  // test APK, which bundles this directory.
  rmSync(raw);
  return target;
}

/**
 * Dolby Vision variants of the probe, for the profile gates. Each carries a generated RPU for its
 * profile and the matching Matroska configuration record, over the same HDR10 frames, so profile
 * 8.1's HDR10-compatible base layer must tone map to exactly the probe's expected patches, while
 * profile 5, which has no compatible base layer, must be refused. The Colour elements are written
 * explicitly, as a real release's mux carries them. Requires dovi_tool and mkvmerge.
 */
export function generateDolbyVisionProbes(fixturesDir) {
  // Like the other fixtures, existing ones are reused, so a machine without the tools can run
  // fixtures made elsewhere.
  // 8.1's base layer is the HDR10 probe and 8.4's the HLG one; profile 5 has no compatible base
  // layer, so what it wraps only has to be ten-bit HEVC.
  const variants = [
    { profile: '8.1', name: 'dv-p8-probe.mkv', source: 'hdr-probe', transfer: 16 },
    { profile: '8.4', name: 'dv-p84-probe.mkv', source: 'hlg-probe', transfer: 18 },
    { profile: '5', name: 'dv-p5-probe.mkv', source: 'hdr-probe', transfer: 16 },
  ];
  const existing = variants.map(({ name }) => join(fixturesDir, name));
  if (existing.every((path) => existsSync(path))) return existing;
  const work = join(fixturesDir, 'dv-work');
  mkdirSync(work, { recursive: true });
  const run = (command, args) =>
    execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    run('dovi_tool', ['--version']);
    run('mkvmerge', ['--version']);
  } catch {
    throw new Error(
      'Dolby Vision fixtures need dovi_tool and mkvmerge: brew install dovi_tool mkvtoolnix',
    );
  }
  const outputs = [];
  for (const { profile, name, source, transfer } of variants) {
    const base = join(work, `${source}.hevc`);
    if (!existsSync(base))
      run('ffmpeg', [
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-i',
        generateHdrProbe(fixturesDir, { transfer: source === 'hlg-probe' ? 'hlg' : 'pq' }),
        '-c:v',
        'copy',
        '-bsf:v',
        'hevc_mp4toannexb',
        '-f',
        'hevc',
        base,
      ]);
    const config = join(work, `generate-${profile}.json`);
    writeFileSync(
      config,
      JSON.stringify({
        cm_version: 'V40',
        length: FRAMES,
        profile,
        level6: {
          max_display_mastering_luminance: 1000,
          min_display_mastering_luminance: 1,
          max_content_light_level: 1000,
          max_frame_average_light_level: 400,
        },
      }),
    );
    const rpu = join(work, `rpu-${profile}.bin`);
    const stream = join(work, `dv-${profile}.hevc`);
    run('dovi_tool', ['generate', '-j', config, '-o', rpu]);
    run('dovi_tool', ['inject-rpu', '-i', base, '--rpu-in', rpu, '-o', stream]);
    const target = join(fixturesDir, name);
    run('mkvmerge', [
      '-q',
      '-o',
      target,
      '--default-duration',
      '0:24fps',
      '--colour-matrix-coefficients',
      '0:9',
      '--colour-range',
      '0:1',
      '--colour-transfer-characteristics',
      `0:${transfer}`,
      '--colour-primaries',
      '0:9',
      '--max-luminance',
      '0:1000',
      '--min-luminance',
      '0:0.0001',
      stream,
    ]);
    outputs.push(target);
  }
  rmSync(work, { recursive: true, force: true });
  return outputs;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2];
  if (!dir)
    throw new Error('Usage: node scripts/test-support/hdr-probe-fixture.mjs <fixtures dir>');
  console.log(`Generated ${generateHdrProbe(dir)}`);
  console.log(`Generated ${generateHdrProbe(dir, { transfer: 'hlg' })}`);
  for (const target of generateDolbyVisionProbes(dir)) console.log(`Generated ${target}`);
}
