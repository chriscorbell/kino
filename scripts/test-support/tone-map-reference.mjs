// The HDR to SDR pipeline Kino's TV shader implements, written a second time.
//
// This exists to be an independent check, not a shared library. The device gate
// compares what the GPU produced against numbers this file computed on the host,
// so a mistake has to be made twice, in two languages, to pass unnoticed. Keep
// it a direct transcription of the standards rather than a clever one.

// SMPTE ST 2084, table 4. Written as the ratios the standard gives so the
// constants can be checked against it by eye.
const M1 = 2610 / 16384;
const M2 = (2523 / 4096) * 128;
const C1 = 3424 / 4096;
const C2 = (2413 / 4096) * 32;
const C3 = (2392 / 4096) * 32;

/** PQ signal to linear luminance, normalised so 1.0 is 10000 cd/m^2. */
export function pqToLinear(signal) {
  const p = Math.pow(Math.max(signal, 0), 1 / M2);
  return Math.pow(Math.max(p - C1, 0) / (C2 - C3 * p), 1 / M1);
}

/** Linear luminance, normalised to 10000 cd/m^2, back to a PQ signal. */
export function linearToPq(linear) {
  const p = Math.pow(Math.max(linear, 0), M1);
  return Math.pow((C1 + C2 * p) / (1 + C3 * p), M2);
}

// ITU-R BT.2390 section 5.4.1. The knee sits at KS and everything below it is
// left alone, so shadow detail passes through untouched and only highlights
// roll off.
export function eetf(signal, sourcePeakNits, targetPeakNits) {
  const maxSource = linearToPq(sourcePeakNits / 10000);
  const maxTarget = linearToPq(targetPeakNits / 10000);
  const e1 = signal / maxSource;
  const maxLum = maxTarget / maxSource;
  const ks = 1.5 * maxLum - 0.5;
  let e2 = e1;
  if (e1 > ks) {
    const t = (e1 - ks) / (1 - ks);
    const t2 = t * t;
    const t3 = t2 * t;
    e2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum;
  }
  return e2 * maxSource;
}

// ITU-R BT.2087 derived BT.2020 to BT.709 conversion, applied to linear light.
const BT2020_TO_BT709 = [
  [1.660491, -0.587641, -0.07285],
  [-0.124551, 1.1329, -0.008349],
  [-0.018151, -0.100579, 1.11873],
];

/**
 * One BT.2020 PQ pixel to one BT.709 pixel encoded for a BT.1886 display.
 *
 * The input is what the Tegra driver hands back from `samplerExternalOES`:
 * already de-matrixed to R'G'B', range expanded, and still PQ encoded.
 */
export function toneMapPixel([r, g, b], { sourcePeakNits = 1000, targetPeakNits = 203 } = {}) {
  // Roll the highlights off in the PQ domain, which is where BT.2390 defines it.
  const rolled = [r, g, b].map((c) => eetf(c, sourcePeakNits, targetPeakNits));
  // Then leave PQ for linear light, where a gamut change is meaningful.
  const linear = rolled.map((c) => pqToLinear(c));
  // Scale so the target peak, not 10000 cd/m^2, is diffuse white.
  const scaled = linear.map((c) => c / (targetPeakNits / 10000));
  const converted = BT2020_TO_BT709.map(
    (row) => row[0] * scaled[0] + row[1] * scaled[1] + row[2] * scaled[2],
  );
  // Clip after the matrix: out of gamut colour has nowhere else to go, and the
  // playback contract would rather lose saturation than invent it.
  const clipped = converted.map((c) => Math.min(Math.max(c, 0), 1));
  // BT.1886 is the display the TV client targets, matching the desktop client's
  // target-trc. Its inverse EOTF at gamma 2.4 is the encoding step.
  return clipped.map((c) => Math.pow(c, 1 / 2.4));
}

/** What the driver returns for one limited-range ten-bit BT.2020 sample. */
export function samplerOutput(luma, cb, cr) {
  const KR = 0.2627;
  const KB = 0.0593;
  const KG = 1 - KR - KB;
  const y = (luma - 64) / 876;
  const cbp = (cb - 512) / 896;
  const crp = (cr - 512) / 896;
  return [
    y + 2 * (1 - KR) * crp,
    y - ((KR * 2 * (1 - KR)) / KG) * crp - ((KB * 2 * (1 - KB)) / KG) * cbp,
    y + 2 * (1 - KB) * cbp,
  ];
}
