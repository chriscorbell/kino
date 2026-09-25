// A 30-second, 60 Mbps stream for the TV buffering gate: more than Media3's default buffer
// holds, less than Kino's. Noise keeps the encoder at its bitrate, since x264 would spend far
// less on a flat picture. The file is too large for the test APK, so pnpm android:check pushes
// it to the device separately.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const output = join(directory, 'remux-60mbps.mp4');
if (!existsSync(output)) {
  mkdirSync(directory, { recursive: true });
  const partial = `${output}.partial.mp4`;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=1920x1080:r=24:d=30,noise=alls=60:allf=t+u',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-b:v',
      '60M',
      '-minrate',
      '60M',
      '-maxrate',
      '60M',
      '-bufsize',
      '60M',
      '-x264-params',
      'nal-hrd=cbr',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, output);
}
console.log(output);
