import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
mkdirSync(directory, { recursive: true });
const temporary = join(directory, 'intro-fixture-source');
mkdirSync(temporary, { recursive: true });
writeFileSync(
  join(temporary, 'captions.srt'),
  '1\n00:00:05,000 --> 00:00:12,000\nSynthetic intro caption\n',
);
writeFileSync(
  join(temporary, 'chapters.ffmeta'),
  `;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=5000
END=12000
title=Intro
[CHAPTER]
TIMEBASE=1/1000
START=12000
END=30000
title=${'Main'.padEnd(4096, ' ')}
`,
);
const source = join(temporary, 'base.mkv');
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
    'color=c=0x1d3040:s=320x180:r=2:d=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=30',
    '-i',
    join(temporary, 'captions.srt'),
    '-f',
    'ffmetadata',
    '-i',
    join(temporary, 'chapters.ffmeta'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:s',
    '-map_chapters',
    '3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-c:s',
    'srt',
    '-t',
    '30',
    source,
  ],
  { stdio: 'pipe' },
);
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-f',
    'hls',
    '-hls_time',
    '30',
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    join(directory, 'intro-hls-%d.ts'),
    join(directory, 'intro-hls.m3u8'),
  ],
  { stdio: 'pipe' },
);

const original = readFileSync(source);

function readElement(bytes, position) {
  const start = position;
  let idWidth = 1;
  while (idWidth <= 4 && !(bytes[position] & (0x80 >> (idWidth - 1)))) idWidth++;
  if (idWidth > 4) throw new Error('Invalid EBML ID');
  let id = 0;
  for (let index = 0; index < idWidth; index++) id = id * 256 + bytes[position++];
  let sizeWidth = 1;
  while (sizeWidth <= 8 && !(bytes[position] & (0x80 >> (sizeWidth - 1)))) sizeWidth++;
  if (sizeWidth > 8) throw new Error('Invalid EBML size');
  let size = BigInt(bytes[position++] & ((0x80 >> (sizeWidth - 1)) - 1));
  for (let index = 1; index < sizeWidth; index++) size = size * 256n + BigInt(bytes[position++]);
  const end = position + Number(size);
  if (end > bytes.length || end < position) throw new Error('Invalid EBML bounds');
  return { id, start, content: position, end, sizeWidth };
}

function children(bytes, start, end) {
  const result = [];
  for (let position = start; position < end;) {
    const child = readElement(bytes, position);
    result.push(child);
    position = child.end;
  }
  return result;
}

function number(value, minimum = 1) {
  let hex = BigInt(value).toString(16);
  hex = hex.padStart(Math.max(minimum * 2, Math.ceil(hex.length / 2) * 2), '0');
  return Buffer.from(hex, 'hex');
}

function encodedSize(value, width = 1) {
  const size = BigInt(value);
  while (size >= (1n << BigInt(width * 7)) - 1n) width++;
  if (width > 8) throw new Error('EBML size overflow');
  return number(size | (1n << BigInt(width * 7)), width);
}

function element(id, ...parts) {
  const payload = Buffer.concat(parts);
  return Buffer.concat([number(id), encodedSize(payload.length), payload]);
}

const integer = (id, value) => element(id, number(value));
const atom = (id, start, end, title, type) =>
  element(
    0xb6,
    integer(0x73c4, id),
    integer(0x91, BigInt(start) * 1_000_000n),
    ...(end === undefined ? [] : [integer(0x92, BigInt(end) * 1_000_000n)]),
    ...(type === undefined ? [] : [integer(0x4588, type)]),
    ...(title === undefined
      ? []
      : [element(0x80, element(0x85, Buffer.isBuffer(title) ? title : Buffer.from(title)))]),
  );
const chapters = (...atoms) => element(0x1043a770, element(0x45b9, ...atoms));

function voidBytes(length) {
  for (let width = 1; width <= 8; width++) {
    const content = length - 1 - width;
    if (content >= 0 && BigInt(content) < (1n << BigInt(width * 7)) - 1n)
      return Buffer.concat([number(0xec), encodedSize(content, width), Buffer.alloc(content)]);
  }
  throw new Error('Void size cannot be represented');
}

const top = children(original, 0, original.length);
const segment = top.find((value) => value.id === 0x18538067);
const parts = children(original, segment.content, segment.end);
const existing = parts.find((value) => value.id === 0x1043a770);
const index = parts.find((value) => value.id === 0x114d9b74);
const indexVoid = parts.find((value) => value.start === index.end && value.id === 0xec);
const indexLength = indexVoid.end - index.start;
const entries = children(original, index.content, index.end)
  .filter((value) => value.id === 0x4dbb)
  .map((entry) => {
    const fields = children(original, entry.content, entry.end);
    const idField = fields.find((value) => value.id === 0x53ab);
    const positionField = fields.find((value) => value.id === 0x53ac);
    const value = (field) =>
      Number(BigInt(`0x${original.subarray(field.content, field.end).toString('hex')}`));
    return { id: value(idField), position: value(positionField) };
  });

function fixture(name, block, tail = false, indexed = true) {
  const bytes = Buffer.from(original);
  const header = top[0];
  const version = children(bytes, header.content, header.end).find((value) => value.id === 0x4287);
  if (version.end - version.content !== 1) throw new Error('Unexpected DocTypeVersion width');
  bytes[version.content] = 5;
  const target = tail ? bytes.length : existing.start;
  const nextIndex = element(
    0x114d9b74,
    ...entries.flatMap((entry) => {
      if (entry.id === 0x1043a770 && (!block || !indexed)) return [];
      const position = entry.id === 0x1043a770 ? target - segment.content : entry.position;
      return [element(0x4dbb, element(0x53ab, number(entry.id)), integer(0x53ac, position))];
    }),
  );
  Buffer.concat([nextIndex, voidBytes(indexLength - nextIndex.length)]).copy(bytes, index.start);
  const inHead = block && !tail ? block : Buffer.alloc(0);
  if (inHead.length > existing.end - existing.start)
    throw new Error('Chapter fixture is too large');
  Buffer.concat([inHead, voidBytes(existing.end - existing.start - inHead.length)]).copy(
    bytes,
    existing.start,
  );
  const result = tail && block ? Buffer.concat([bytes, block]) : bytes;
  encodedSize(result.length - segment.content, segment.sizeWidth).copy(
    result,
    segment.content - segment.sizeWidth,
  );
  writeFileSync(join(directory, `intro-${name}.mkv`), result);
}

const opening = atom(1, 5_000, 12_000, 'Intro');
const main = atom(2, 12_000, 30_000, 'Main');
fixture('label', chapters(opening, main));
fixture('label-tail', chapters(opening, main), true);
fixture(
  'type',
  chapters(
    atom(1, 5_000, undefined, 'Arbitrary', 1),
    atom(2, 7_000, undefined, 'Ordinary'),
    atom(3, 12_000, 30_000, 'Main', 0),
  ),
);
fixture('type-zero', chapters(atom(1, 5_000, 12_000, 'Intro', 0), main));
fixture('no-opening', chapters(atom(1, 0, 12_000, 'Part 1'), main));
fixture('no-chapters', null);
fixture('unindexed-tail', chapters(opening, main), true, false);
fixture('conflicting', chapters(opening, atom(3, 15_000, 22_000, 'Opening'), main));
fixture('malformed-title', chapters(atom(1, 5_000, 12_000, Buffer.from([0xc3, 0x28])), main));
fixture(
  'oversized-tail',
  chapters(atom(1, 5_000, 12_000, 'Intro'), atom(2, 12_000, 30_000, 'x'.repeat(65_536))),
  true,
);
rmSync(temporary, { recursive: true, force: true });
console.log('Wrote bounded Matroska intro fixtures');
