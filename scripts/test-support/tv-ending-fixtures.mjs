import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
mkdirSync(directory, { recursive: true });
const encode = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'pipe',
  });

// One independently decodable frame per second keeps the 30-minute seek fixture below 400 KiB.
encode([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x34373b:s=320x180:r=1:d=1800',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-g',
  '1',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  join(directory, 'up-next-long.mp4'),
]);
const transport = join(directory, 'up-next-pcr.ts');
encode([
  '-i',
  join(directory, 'h264-sdr-aac.mp4'),
  '-t',
  '3',
  '-map',
  '0:v:0',
  '-c',
  'copy',
  '-f',
  'mpegts',
  transport,
]);
const packets = readFileSync(transport);
if (packets.length % 188) throw new Error('Incomplete MPEG-TS fixture');
let removed = 0;
for (let offset = 0; offset < packets.length; offset += 188) {
  if (packets[offset] !== 0x47) throw new Error('Invalid MPEG-TS sync byte');
  const adaptation = (packets[offset + 3] >> 4) & 3;
  if (adaptation >= 2 && packets[offset + 4] > 0 && packets[offset + 5] & 0x10) {
    // Media3 derives a TS duration from PCR. Retain coded video and PTS, replacing
    // the optional PCR field with adaptation stuffing to exercise unknown duration.
    packets[offset + 5] &= 0xef;
    packets.fill(0xff, offset + 6, offset + 12);
    removed++;
  }
}
if (!removed) throw new Error('Fixture had no PCR fields');
writeFileSync(join(directory, 'up-next-unknown.ts'), packets);
