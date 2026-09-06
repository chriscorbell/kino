#!/usr/bin/env node
// Playback fixture gate for the native macOS shell. Generates small synthetic
// media files with ffmpeg, plays each through Kino's probe mode, and asserts
// the playback contract: hardware-only video decoding, HDR inputs accepted for
// tone mapping, declared audio codecs, embedded and external subtitles,
// chapters, and clean rejection of undecodable or broken sources.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = process.env.KINO_FIXTURES_DIR ?? join(repoRoot, 'build', 'fixtures');
const appBinary =
  process.env.KINO_APP_BINARY ?? join(repoRoot, 'build', 'macos', 'Kino.app/Contents/MacOS/Kino');

const videoSource = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=6'];
const audioSource = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6'];
const hdr10Params =
  'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400';
const hdrTransfers = new Map([
  ['hevc-hdr10-eac3.mkv', 'smpte2084'],
  ['hevc-hlg-flac.mkv', 'arib-std-b67'],
]);

function hasHdrMetadata(path, transfer) {
  try {
    const result = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=color_transfer,color_primaries',
          '-of',
          'json',
          path,
        ],
        { encoding: 'utf8' },
      ),
    );
    return (
      result.streams[0]?.color_transfer === transfer &&
      result.streams[0]?.color_primaries === 'bt2020'
    );
  } catch {
    return false;
  }
}

const srtText = `1
00:00:00,500 --> 00:00:04,000
Kino fixture subtitles
`;
const assText = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Alignment
Style: Default,Arial,28,&H00FFFFFF,2

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.50,0:00:04.00,Default,Kino styled subtitles
`;
const vttText = `WEBVTT

00:00.500 --> 00:04.000
Kino external subtitles
`;
const chapterMetadata = `;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=3000
title=Intro
[CHAPTER]
TIMEBASE=1/1000
START=3000
END=6000
title=Part 1
`;

function encode(name, args) {
  const target = join(fixturesDir, name);
  const transfer = hdrTransfers.get(name);
  if (existsSync(target) && (!transfer || hasHdrMetadata(target, transfer))) return target;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, target], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (transfer && !hasHdrMetadata(target, transfer))
    throw new Error(`${name} is missing its required HDR metadata`);
  return target;
}

function writeFixture(name, content) {
  const target = join(fixturesDir, name);
  if (!existsSync(target)) writeFileSync(target, content);
  return target;
}

function generateFixtures() {
  mkdirSync(fixturesDir, { recursive: true });
  const subsSrt = writeFixture('embedded.srt', srtText);
  const subsAss = writeFixture('embedded.ass', assText);
  const chaptersMeta = writeFixture('chapters.ffmeta', chapterMetadata);

  const h264 = encode('h264-sdr-aac.mp4', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
  ]);
  encode('hevc-sdr-ac3.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'ac3',
    '-ac',
    '2',
  ]);
  encode('hevc-hdr10-eac3.mkv', [
    ...videoSource,
    ...audioSource,
    '-vf',
    'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p10le',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    'smpte2084',
    '-colorspace',
    'bt2020nc',
    '-x265-params',
    hdr10Params,
    '-c:a',
    'eac3',
    '-ac',
    '2',
  ]);
  encode('hevc-hlg-flac.mkv', [
    ...videoSource,
    ...audioSource,
    '-vf',
    'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc',
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p10le',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    'arib-std-b67',
    '-x265-params',
    'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
    '-colorspace',
    'bt2020nc',
    '-c:a',
    'flac',
    '-ac',
    '2',
  ]);
  encode('av1-aac.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libsvtav1',
    '-preset',
    '12',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
  ]);
  encode('ffv1-software-only.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'ffv1',
    '-c:a',
    'aac',
    '-ac',
    '2',
  ]);
  encode('h264-alac.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'alac',
    '-ac',
    '2',
  ]);
  encode('h264-dts.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'dca',
    '-strict',
    'experimental',
    '-ac',
    '2',
  ]);
  encode('h264-pcm.mkv', [
    ...videoSource,
    ...audioSource,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'pcm_s16le',
    '-ac',
    '2',
  ]);
  encode('subs-embedded.mkv', [
    ...videoSource,
    ...audioSource,
    '-i',
    subsSrt,
    '-i',
    subsAss,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:s',
    '-map',
    '3:s',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-c:s',
    'copy',
  ]);
  encode('chapters-intro.mkv', [
    ...videoSource,
    ...audioSource,
    '-i',
    chaptersMeta,
    '-map_metadata',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
  ]);
  writeFixture('external.srt', srtText);
  writeFixture('external.vtt', vttText);
  if (!existsSync(join(fixturesDir, 'corrupt.mp4'))) {
    writeFixture('corrupt.mp4', readFileSync(h264).subarray(0, 24 * 1024));
  }
}

// PGS, TrueHD, DTS-HD, Atmos, and Dolby Vision inputs cannot be synthesized
// with ffmpeg encoders; those remain manual real-device release gates.
const fixtures = [
  { file: 'h264-sdr-aac.mp4', expect: { outcome: 'played' } },
  { file: 'hevc-sdr-ac3.mkv', expect: { outcome: 'played' } },
  { file: 'hevc-hdr10-eac3.mkv', expect: { outcome: 'played' } },
  { file: 'hevc-hlg-flac.mkv', expect: { outcome: 'played' } },
  {
    file: 'av1-aac.mkv',
    note: 'plays only with AV1 hardware decoding; must otherwise reject',
    expect: { outcome: ['played', 'failed'], errorCode: 'hardware-decoding-unavailable' },
  },
  {
    file: 'ffv1-software-only.mkv',
    expect: { outcome: 'failed', errorCode: 'hardware-decoding-unavailable' },
  },
  { file: 'h264-alac.mkv', expect: { outcome: 'played' } },
  { file: 'h264-dts.mkv', expect: { outcome: 'played' } },
  { file: 'h264-pcm.mkv', expect: { outcome: 'played' } },
  {
    file: 'subs-embedded.mkv',
    expect: { outcome: 'played', subtitleCodecs: ['subrip', 'ass'] },
  },
  {
    file: 'h264-sdr-aac.mp4',
    label: 'external-srt',
    subtitles: 'external.srt',
    expect: { outcome: 'played', externalSubtitle: true },
  },
  {
    file: 'h264-sdr-aac.mp4',
    label: 'external-vtt',
    subtitles: 'external.vtt',
    expect: { outcome: 'played', externalSubtitle: true },
  },
  { file: 'chapters-intro.mkv', expect: { outcome: 'played', minChapters: 2 } },
  { file: 'corrupt.mp4', expect: { outcome: 'failed' } },
  { file: 'missing.mkv', missing: true, expect: { outcome: 'failed' } },
];

function runProbe(fixture) {
  const mediaPath = join(fixturesDir, fixture.file);
  const env = { ...process.env, KINO_PLAYBACK_PROBE: mediaPath };
  if (fixture.subtitles) env.KINO_PLAYBACK_PROBE_SUBS = join(fixturesDir, fixture.subtitles);
  const run = spawnSync(appBinary, [], { encoding: 'utf8', env, timeout: 60_000 });
  const line = (run.stdout ?? '')
    .split('\n')
    .findLast((candidate) => candidate.startsWith('KINO_PROBE_RESULT '));
  if (!line) {
    const detail = run.error ? run.error.message : `exit ${run.status}`;
    return { failure: `no probe verdict (${detail})`, stderr: run.stderr };
  }
  return { result: JSON.parse(line.slice('KINO_PROBE_RESULT '.length)) };
}

function assertExpectations(fixture, result) {
  const problems = [];
  const { expect } = fixture;
  const outcomes = Array.isArray(expect.outcome) ? expect.outcome : [expect.outcome];
  if (!outcomes.includes(result.outcome)) {
    problems.push(
      `outcome ${result.outcome} (${result.errorCode ?? 'no code'}), expected ${outcomes.join(' or ')}`,
    );
  }
  if (expect.errorCode && result.outcome === 'failed' && result.errorCode !== expect.errorCode) {
    problems.push(`error code ${result.errorCode}, expected ${expect.errorCode}`);
  }
  if (expect.minChapters && result.chapters < expect.minChapters) {
    problems.push(`${result.chapters} chapters, expected at least ${expect.minChapters}`);
  }
  const codecs = (result.subtitleTracks ?? []).map((track) => track.codec);
  for (const codec of expect.subtitleCodecs ?? []) {
    if (!codecs.includes(codec))
      problems.push(`missing ${codec} subtitle track (saw: ${codecs.join(', ') || 'none'})`);
  }
  if (expect.externalSubtitle && !(result.subtitleTracks ?? []).some((track) => track.external)) {
    problems.push('no external subtitle track appeared');
  }
  return problems;
}

if (!process.argv.includes('--generate-only') && !existsSync(appBinary)) {
  console.error(`Kino binary not found at ${appBinary}. Run "pnpm macos:build" first.`);
  process.exit(1);
}
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg is required to generate playback fixtures: brew install ffmpeg');
  process.exit(1);
}

console.log('Generating playback fixtures…');
generateFixtures();
if (process.argv.includes('--generate-only')) process.exit(0);

let failures = 0;
for (const fixture of fixtures) {
  const name = fixture.label ?? fixture.file;
  const { failure, result, stderr } = runProbe(fixture);
  if (failure) {
    failures += 1;
    console.log(`✗ ${name}: ${failure}`);
    if (stderr) console.log(stderr.split('\n').slice(-8).join('\n'));
    continue;
  }
  const problems = assertExpectations(fixture, result);
  if (problems.length > 0) {
    failures += 1;
    console.log(`✗ ${name}: ${problems.join('; ')}`);
  } else {
    const detail =
      result.outcome === 'failed' ? `rejected with ${result.errorCode}` : result.outcome;
    console.log(`✓ ${name}: ${detail}${fixture.note ? ` (${fixture.note})` : ''}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} playback fixture(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${fixtures.length} playback fixtures satisfied the contract.`);
