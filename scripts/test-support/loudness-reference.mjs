// The loudness measurement Kino's stereo normalizer implements, written a second time.
//
// This exists to be an independent check, not a shared library. The device gate compares what the
// Kotlin processor measured against numbers this file computed on the host, so a mistake in the
// K-weighting, the gating or the gain law has to be made twice, in two languages, to pass
// unnoticed. Keep it a direct transcription of ITU-R BS.1770-4 rather than a clever one.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// BS.1770-4 stage 1, the high shelf standing in for the head, and stage 2, the RLB high-pass.
// Written as the filter parameters rather than the standard's tabulated coefficients so any sample
// rate works. At 48 kHz these reproduce that table exactly, which the gate asserts.
const SHELF_FREQUENCY = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
const SHELF_VB_EXPONENT = 0.4996667741545416;
const HIGH_PASS_FREQUENCY = 38.13547087602444;
const HIGH_PASS_Q = 0.5003270373238773;

export function kWeightingCoefficients(sampleRate) {
  const shelfK = Math.tan((Math.PI * SHELF_FREQUENCY) / sampleRate);
  const vh = Math.pow(10, SHELF_GAIN_DB / 20);
  const vb = Math.pow(vh, SHELF_VB_EXPONENT);
  const shelfA0 = 1 + shelfK / SHELF_Q + shelfK * shelfK;
  const shelf = [
    (vh + (vb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfA0,
    (2 * (shelfK * shelfK - vh)) / shelfA0,
    (vh - (vb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfA0,
    (2 * (shelfK * shelfK - 1)) / shelfA0,
    (1 - shelfK / SHELF_Q + shelfK * shelfK) / shelfA0,
  ];
  const passK = Math.tan((Math.PI * HIGH_PASS_FREQUENCY) / sampleRate);
  const passA0 = 1 + passK / HIGH_PASS_Q + passK * passK;
  const highPass = [
    1,
    -2,
    1,
    (2 * (passK * passK - 1)) / passA0,
    (1 - passK / HIGH_PASS_Q + passK * passK) / passA0,
  ];
  return [shelf, highPass];
}

function filter([b0, b1, b2, a1, a2], samples) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return samples.map((x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  });
}

const LOUDNESS_OFFSET = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = 10;
const BLOCK_SECONDS = 0.4;

/** Gated integrated loudness of a stereo program, in LUFS. */
export function integratedLufs(left, right, sampleRate) {
  const [shelf, highPass] = kWeightingCoefficients(sampleRate);
  const weight = (channel) => filter(highPass, filter(shelf, channel));
  const weightedLeft = weight(left);
  const weightedRight = weight(right);
  const blockFrames = Math.trunc(sampleRate * BLOCK_SECONDS);

  const blocks = [];
  for (let start = 0; start + blockFrames <= left.length; start += blockFrames) {
    let sum = 0;
    for (let i = start; i < start + blockFrames; i++) {
      sum += weightedLeft[i] * weightedLeft[i] + weightedRight[i] * weightedRight[i];
    }
    const power = sum / blockFrames;
    if (power > 0) blocks.push(power);
  }

  // The absolute gate first, then the relative gate at 10 LU below the mean of what survived it.
  const aboveAbsolute = blocks.filter(
    (p) => LOUDNESS_OFFSET + 10 * Math.log10(p) > ABSOLUTE_GATE_LUFS,
  );
  if (aboveAbsolute.length === 0) return ABSOLUTE_GATE_LUFS;
  const meanAbsolute = aboveAbsolute.reduce((a, b) => a + b, 0) / aboveAbsolute.length;
  const relativeGate = LOUDNESS_OFFSET + 10 * Math.log10(meanAbsolute) - RELATIVE_GATE_LU;
  const gated = aboveAbsolute.filter((p) => LOUDNESS_OFFSET + 10 * Math.log10(p) > relativeGate);
  const surviving = gated.length === 0 ? aboveAbsolute : gated;
  const mean = surviving.reduce((a, b) => a + b, 0) / surviving.length;
  return LOUDNESS_OFFSET + 10 * Math.log10(mean);
}

// The probe the gate plays through the processor. A film-like level, then silence the absolute gate
// must discard, then a passage far enough down that the relative gate must discard it too, then the
// film level again for long enough that the gain settles. Both sides synthesize this from the same
// description, so only the measurement is implemented twice.
export const PROBE = {
  sampleRate: 48000,
  frequency: 1000,
  segments: [
    { seconds: 4, amplitude: 0.0484 },
    { seconds: 2, amplitude: 0 },
    { seconds: 2, amplitude: 0.0086 },
    { seconds: 8, amplitude: 0.0484 },
  ],
};

export function synthesize({ sampleRate, frequency, segments }) {
  const left = [];
  const right = [];
  let frame = 0;
  for (const { seconds, amplitude } of segments) {
    const count = Math.round(seconds * sampleRate);
    for (let i = 0; i < count; i++, frame++) {
      const value = amplitude * Math.sin((2 * Math.PI * frequency * frame) / sampleRate);
      left.push(value);
      right.push(value);
    }
  }
  return { left, right };
}

// Matches LoudnessNormalizer's companion values.
const TARGET_LUFS = -19;
const MAX_BOOST_DB = 12;
const MAX_CUT_DB = -6;

const { left, right } = synthesize(PROBE);
const measured = integratedLufs(left, right, PROBE.sampleRate);
const expected = {
  probe: PROBE,
  targetLufs: TARGET_LUFS,
  integratedLufs: measured,
  gainDb: Math.min(MAX_BOOST_DB, Math.max(MAX_CUT_DB, TARGET_LUFS - measured)),
  kWeightingAt48k: kWeightingCoefficients(48000),
};

const destination = join(process.argv[2] ?? 'build/android-fixtures', 'loudness-expected.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(expected, null, 2)}\n`);
console.log(
  `Loudness probe: ${measured.toFixed(2)} LUFS, gain ${expected.gainDb.toFixed(2)} dB -> ${destination}`,
);
