import { t as enUS } from '../locales/index.ts';
import type { CoreSource } from './types';

/**
 * What a source row shows, in the same shape on desktop and TV. Every field is
 * null when nothing reliable says otherwise: a missing range is not SDR, and a
 * size the add-on wrote with a slash is not split into two numbers.
 *
 * Structured hints win. Text is parsed only for tokens release names spell the
 * same way everywhere, and whatever is not recognised stays in `original` for
 * the details view rather than being guessed at.
 */
export interface SourceFields {
  /** "2160p", "1080p", "720p". */
  resolution: string | null;
  /** "Remux", "BluRay", "WEB-DL", "WEBRip", "HDTV". */
  releaseType: string | null;
  releaseGroup: string | null;
  /** Upper-case language codes in the add-on's order. */
  languages: string[];
  /** "DTS-HD MA 5.1", "DDP 5.1", "Atmos", "AAC 2.0". */
  audio: string | null;
  /** "HEVC", "H.264", "AV1". */
  videoCodec: string | null;
  /** "DV + HDR", "HDR10", "HLG". Only when the add-on says so. */
  videoRange: string | null;
  size: SourceSize | null;
  /** Estimated from size and runtime, or quoted when the add-on states one. */
  bitrate: string | null;
  peers: number | null;
  /** The primary text when nothing structured could be read. */
  fallbackTitle: string;
  original: {
    name: string | null;
    description: string | null;
    filename: string | null;
    /** Lines of add-on text no field consumed, for the details view. */
    remainder: string[];
  };
}

export type SourceSize =
  /** From the add-on's structured hint, or an unambiguous "12.3 GB" in its text. */
  | { kind: 'bytes'; bytes: number }
  /** Text such as "6.8 / 13.6 GB" that Kino shows as written rather than interpreting. */
  | { kind: 'text'; text: string };

const resolutionPattern = /\b(2160p|1440p|1080p|720p|576p|480p)\b|\b(4k|uhd)\b/i;

const releaseTypes: Array<[RegExp, string]> = [
  [/\b(?:bd|blu-?ray\W?)?remux\b/i, 'Remux'],
  [/\bweb-?dl\b/i, 'WEB-DL'],
  [/\bweb-?rip\b/i, 'WEBRip'],
  [/\b(?:hd|pd)tv(?:rip)?\b/i, 'HDTV'],
  [/\b(?:uhd|bd|br)rip\b/i, 'BDRip'],
  [/\bblu-?ray\b/i, 'BluRay'],
  [/\bdvd(?:rip)?\b/i, 'DVD'],
  [/\b(?:hd)?cam(?:rip)?\b|\bts(?:rip)?\b|\btelesync\b/i, 'CAM'],
  // Bare WEB, as in "MA.WEB-GROUP": a web source of unstated kind.
  [/\bweb\b/i, 'WEB'],
];

const videoCodecs: Array<[RegExp, string]> = [
  [/\b(?:x|h\.?)?265\b|\bhevc\b/i, 'HEVC'],
  [/\b(?:x|h\.?)?264\b|\bavc\b/i, 'H.264'],
  [/\bav1\b/i, 'AV1'],
  [/\bvp9\b/i, 'VP9'],
  [/\bxvid\b|\bdivx\b/i, 'XviD'],
];

// Ordered so a fuller name wins over its prefix, e.g. DTS-HD MA before DTS.
const audioCodecs: Array<[RegExp, string]> = [
  [/\btruehd\b/i, 'TrueHD'],
  [/\bdts-?(?:hd\W?ma|dh\W?ma|hd)\b/i, 'DTS-HD MA'],
  [/\bdts(?:-?x)\b/i, 'DTS:X'],
  [/\bdts(?![a-z])/i, 'DTS'],
  [/\b(?:ddp|dd\+|e-?ac-?3|eac3)(?![a-z])/i, 'DDP'],
  [/\b(?:dd|ac-?3|dolby\W?digital)(?![a-z])/i, 'AC3'],
  [/\baac(?![a-z])/i, 'AAC'],
  [/\bopus(?![a-z])/i, 'Opus'],
  [/\bflac\b/i, 'FLAC'],
  [/\b(?:lpcm|pcm)\b/i, 'PCM'],
  [/\bmp3\b/i, 'MP3'],
];
const channelsPattern = /(?<!\d)([1-9])[.,]([0-2])(?!\d)/;
const atmosPattern = /\batmos\b/i;

const sizePattern = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|GiB|MiB|TiB)\b/i;
// Two sizes joined by a slash, as some add-ons write "file / pack".
const slashSizePattern = /\d+(?:[.,]\d+)?\s*(?:[A-Z]i?B\s*)?\/\s*\d+(?:[.,]\d+)?\s*[A-Z]i?B\b/i;
const bitratePattern = /(\d+(?:[.,]\d+)?)\s*(?:mbps|mb\/s|mbit\/?s)\b/i;
const peersPattern = /👤\s*(\d+)/u;
// Add-on marker lines: peers, size, tracker, or a row of flags.
const markerLine = /👤|💾|⚙/u;
const flagsOnlyLine = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\s/|])+$/u;

const flagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
// Flags name a region; the row names a language.
const regionLanguages: Record<string, string> = {
  GB: 'EN',
  US: 'EN',
  AU: 'EN',
  CA: 'EN',
  IT: 'IT',
  FR: 'FR',
  DE: 'DE',
  ES: 'ES',
  MX: 'ES',
  PT: 'PT',
  BR: 'PT',
  RU: 'RU',
  UA: 'UK',
  PL: 'PL',
  HU: 'HU',
  CZ: 'CS',
  SK: 'SK',
  NL: 'NL',
  SE: 'SV',
  NO: 'NO',
  DK: 'DA',
  FI: 'FI',
  JP: 'JA',
  CN: 'ZH',
  TW: 'ZH',
  KR: 'KO',
  IN: 'HI',
  TR: 'TR',
  GR: 'EL',
  RO: 'RO',
  BG: 'BG',
  HR: 'HR',
  RS: 'SR',
  IL: 'HE',
  SA: 'AR',
  AE: 'AR',
  TH: 'TH',
  VN: 'VI',
  ID: 'ID',
};
// Three-letter tokens release names use, only as whole words.
const languageTokens: Record<string, string> = {
  ENG: 'EN',
  ITA: 'IT',
  FRE: 'FR',
  FRA: 'FR',
  GER: 'DE',
  DEU: 'DE',
  SPA: 'ES',
  ESP: 'ES',
  POR: 'PT',
  RUS: 'RU',
  UKR: 'UK',
  POL: 'PL',
  HUN: 'HU',
  CZE: 'CS',
  NLD: 'NL',
  DUT: 'NL',
  SWE: 'SV',
  NOR: 'NO',
  DAN: 'DA',
  FIN: 'FI',
  JPN: 'JA',
  CHI: 'ZH',
  KOR: 'KO',
  HIN: 'HI',
  TUR: 'TR',
  GRE: 'EL',
};

function flagToRegion(flag: string) {
  return Array.from(flag)
    .map((symbol) => String.fromCharCode((symbol.codePointAt(0) ?? 0) - 0x1f1e6 + 65))
    .join('');
}

function parseSizeBytes(amount: string, unit: string) {
  const value = Number(amount.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const scale = /^t/i.test(unit) ? 1024 ** 4 : /^g/i.test(unit) ? 1024 ** 3 : 1024 ** 2;
  return Math.round(value * scale);
}

function formatBytes(bytes: number) {
  // One decimal at every size, so "54.3 GB" and "6.9 GB" line up in a column.
  const gibibytes = bytes / 1024 ** 3;
  if (gibibytes >= 1) return enUS.format.gigabytes(gibibytes.toFixed(1));
  return enUS.format.megabytes(Math.round(bytes / 1024 ** 2));
}

/** "2h 22min", "142 min", and "142" all mean minutes; anything else is unknown. */
export function runtimeMinutes(runtime: string | null | undefined) {
  if (!runtime) return null;
  const hours = /(\d+)\s*h/i.exec(runtime);
  const minutes = /(\d+)\s*m/i.exec(runtime);
  if (hours || minutes) {
    return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0) || null;
  }
  const bare = /^\s*(\d+)\s*$/.exec(runtime);
  return bare ? Number(bare[1]) || null : null;
}

function estimateBitrate(bytes: number, minutes: number | null) {
  if (!minutes) return null;
  const megabitsPerSecond = (bytes * 8) / (minutes * 60) / 1_000_000;
  if (!Number.isFinite(megabitsPerSecond) || megabitsPerSecond < 0.1) return null;
  return enUS.format.estimatedMegabits(
    megabitsPerSecond >= 10 ? Math.round(megabitsPerSecond) : megabitsPerSecond.toFixed(1),
  );
}

function detectRange(text: string) {
  const dolbyVision = /\b(?:dv|dovi|dolby\W?vision)\b/i.test(text);
  const hdr10Plus = /\bhdr10\+/i.test(text);
  const hdr10 = /\bhdr10\b/i.test(text);
  const hdr = /\bhdr\b/i.test(text);
  const hlg = /\bhlg\b/i.test(text);
  const parts: string[] = [];
  if (dolbyVision) parts.push('DV');
  if (hdr10Plus) parts.push('HDR10+');
  else if (hdr10) parts.push('HDR10');
  else if (hdr) parts.push('HDR');
  if (hlg) parts.push('HLG');
  if (parts.length > 0) return parts.join(' + ');
  // Only an explicit claim counts. Absence of HDR tokens says nothing.
  return /\bsdr\b/i.test(text) ? 'SDR' : null;
}

function detectAudio(text: string) {
  const codec = audioCodecs.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const atmos = atmosPattern.test(text);
  const channels = channelsPattern.exec(text);
  const parts = [codec, atmos ? 'Atmos' : null, channels ? `${channels[1]}.${channels[2]}` : null];
  const label = parts.filter(Boolean).join(' ');
  return label || null;
}

function detectGroup(text: string) {
  // A trailing "-GROUP" on a release name, before any extension, or a
  // bracketed tag at the end such as "[QxR]". Scene names put the year and
  // resolution before the group, which keeps a hyphenated title from matching.
  const bracket = /\[([A-Za-z0-9.]{2,20})\](?:\.[a-z0-9]{2,4})?\s*$/.exec(text)?.[1];
  if (bracket) return bracket;
  const group = /-([A-Za-z0-9]{2,20})(?:\.[a-z0-9]{2,4})?\s*$/.exec(text)?.[1];
  if (!group) return null;
  // Channel layouts and codecs end release names too; those are not groups.
  if (/^\d+$/.test(group) || /^(?:x26[45]|h26[45]|hevc|aac|ac3|dts|ddp|dl|rip)$/i.test(group)) {
    return null;
  }
  return group;
}

function detectLanguages(text: string) {
  const found: string[] = [];
  const push = (code: string) => {
    if (!found.includes(code)) found.push(code);
  };
  for (const flag of text.match(flagPattern) ?? []) {
    push(regionLanguages[flagToRegion(flag)] ?? flagToRegion(flag));
  }
  if (found.length === 0) {
    for (const token of text.match(/\b[A-Z]{3}\b/g) ?? []) {
      const code = languageTokens[token];
      if (code) push(code);
    }
    if (found.length === 0 && /\bmulti\b/i.test(text)) push('MULTI');
  }
  return found;
}

/** The line that reads like a release name: the longest one without an add-on marker. */
function releaseLine(lines: string[]) {
  const candidates = lines.filter((line) => !markerLine.test(line) && !flagsOnlyLine.test(line));
  return candidates.sort((left, right) => right.length - left.length)[0] ?? null;
}

export function sourceFields(source: CoreSource): SourceFields {
  const name = source.name?.trim() || null;
  const description = source.description?.trim() || null;
  const filename = source.hints.filename?.trim() || null;
  const splitLines = (value: string | null) =>
    (value ?? '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  const nameLines = splitLines(name);
  const descriptionLines = splitLines(description);
  const lines = [...nameLines, ...descriptionLines];
  // The filename is the fullest spelling of the release when the add-on
  // supplies one; description text often arrives shortened.
  // The add-on's release line is consumed even when a filename hint replaces
  // it as the primary spelling; it is the same release, not leftover text.
  const described = releaseLine(descriptionLines);
  const release = filename ?? described ?? releaseLine(nameLines);
  const corpus = [filename, ...lines].filter(Boolean).join('\n');

  const resolutionMatch = resolutionPattern.exec(corpus);
  const explicitResolution = resolutionMatch?.[1]?.toLowerCase();
  // "4k" and "UHD" name the same output size without the "p" spelling.
  const resolution = explicitResolution ?? (resolutionMatch ? '2160p' : null);
  const releaseType = releaseTypes.find(([pattern]) => pattern.test(corpus))?.[1] ?? null;
  const videoCodec = videoCodecs.find(([pattern]) => pattern.test(corpus))?.[1] ?? null;

  let size: SourceSize | null = null;
  if (source.hints.videoSize && source.hints.videoSize > 0) {
    size = { kind: 'bytes', bytes: source.hints.videoSize };
  } else {
    const slash = slashSizePattern.exec(corpus);
    const single = sizePattern.exec(corpus);
    if (slash) size = { kind: 'text', text: slash[0].replace(/\s+/g, ' ') };
    else if (single?.[1] && single[2]) {
      const bytes = parseSizeBytes(single[1], single[2]);
      size = bytes ? { kind: 'bytes', bytes } : null;
    }
  }

  const statedBitrate = bitratePattern.exec(corpus)?.[1];
  const peers = peersPattern.exec(corpus)?.[1];

  const consumed = new Set<string>();
  for (const line of lines) {
    if (markerLine.test(line) || flagsOnlyLine.test(line) || line === described) {
      consumed.add(line);
    }
  }

  return {
    resolution,
    releaseType,
    releaseGroup: release ? detectGroup(release) : null,
    languages: detectLanguages(corpus),
    audio: detectAudio(corpus),
    videoCodec,
    videoRange: detectRange(corpus),
    size,
    bitrate: statedBitrate ? enUS.format.megabits(statedBitrate.replace(',', '.')) : null,
    peers: peers ? Number(peers) : null,
    fallbackTitle: release ?? lines[0] ?? enUS.sources.unnamed,
    original: {
      name,
      description,
      filename,
      remainder: descriptionLines.filter((line) => !consumed.has(line)),
    },
  };
}

/** Fills in the size-derived bitrate once the title's runtime is known. */
export function withEstimatedBitrate(fields: SourceFields, runtime: string | null | undefined) {
  if (fields.bitrate || fields.size?.kind !== 'bytes') return fields;
  const estimate = estimateBitrate(fields.size.bytes, runtimeMinutes(runtime));
  return estimate ? { ...fields, bitrate: estimate } : fields;
}

export function sizeLabel(size: SourceSize | null) {
  if (!size) return null;
  return size.kind === 'bytes' ? formatBytes(size.bytes) : size.text;
}

/** True when the row would otherwise be blank and needs the fallback title. */
export function hasStructure(fields: SourceFields) {
  return Boolean(
    fields.resolution ||
    fields.releaseType ||
    fields.videoCodec ||
    fields.audio ||
    fields.videoRange ||
    fields.languages.length > 0,
  );
}
