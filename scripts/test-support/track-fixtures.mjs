import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function generateTrackFixtures(directory) {
  mkdirSync(directory, { recursive: true });
  for (const [language, caption] of [
    ['eng', 'English fixture'],
    ['spa', 'Spanish fixture'],
  ]) {
    writeFileSync(
      join(directory, `track-${language}.srt`),
      `1\n00:00:00,000 --> 00:00:12,000\n${caption}\n`,
    );
  }
  const base = join(directory, 'two-tracks.mkv');
  const encode = (args) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: 'pipe',
    });
  if (!existsSync(base))
    encode([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24:duration=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=12',
      '-i',
      join(directory, 'track-eng.srt'),
      '-i',
      join(directory, 'track-spa.srt'),
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-map',
      '3:s',
      '-map',
      '4:s',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-c:s',
      'srt',
      '-metadata:s:a:0',
      'language=eng',
      '-metadata:s:a:1',
      'language=spa',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata:s:s:1',
      'language=spa',
      base,
    ]);
  for (const [name, language] of [
    ['replacement-tracks.mkv', 'spa'],
    ['fallback-tracks.mkv', 'deu'],
  ]) {
    const path = join(directory, name);
    if (!existsSync(path))
      encode([
        '-i',
        base,
        '-map',
        '0',
        '-c',
        'copy',
        '-metadata:s:a:1',
        `language=${language}`,
        '-metadata:s:s:1',
        `language=${language}`,
        path,
      ]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateTrackFixtures(resolve(process.argv[2]));
}
