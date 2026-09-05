import { t as enUS } from '../locales';

export interface SubtitleTrack {
  codec?: string;
  external: boolean;
  forced?: boolean;
  hearingImpaired?: boolean;
  id: number;
  lang?: string;
  selected: boolean;
  title?: string;
}

export interface AddonSubtitle {
  id: string;
  lang: string;
  url: string;
}

const codecLabels: Record<string, string> = {
  ass: 'ASS',
  dvb_subtitle: 'DVB',
  dvd_subtitle: 'DVD',
  hdmv_pgs_subtitle: 'PGS',
  mov_text: 'MP4',
  ssa: 'SSA',
  subrip: 'SRT',
  webvtt: 'VTT',
};

function languageName(code: string) {
  try {
    const resolved = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return resolved && resolved.toLowerCase() !== code ? resolved : null;
  } catch {
    return null;
  }
}

export function languagesMatch(candidate: string | undefined, preferred: string) {
  const left = candidate?.trim().toLowerCase() ?? '';
  const right = preferred.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftName = languageName(left);
  return leftName !== null && leftName === languageName(right);
}

export function parseSubtitleTracks(value: unknown): SubtitleTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): SubtitleTrack[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== 'number' || !Number.isFinite(entry.id)) return [];
    return [
      {
        ...(typeof entry.codec === 'string' ? { codec: entry.codec } : {}),
        external: entry.external === true,
        ...(typeof entry.forced === 'boolean' ? { forced: entry.forced } : {}),
        ...(typeof entry.hearingImpaired === 'boolean'
          ? { hearingImpaired: entry.hearingImpaired }
          : {}),
        id: entry.id,
        ...(typeof entry.lang === 'string' ? { lang: entry.lang } : {}),
        selected: entry.selected === true,
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
      },
    ];
  });
}

export function parseAddonSubtitles(value: unknown): AddonSubtitle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): AddonSubtitle[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) return [];
    const lang = typeof entry.lang === 'string' ? entry.lang : '';
    return [{ id: typeof entry.id === 'string' ? entry.id : entry.url, lang, url: entry.url }];
  });
}

export function preferredSubtitleTrack(
  tracks: SubtitleTrack[],
  preferredLanguage: string | null,
): SubtitleTrack | null {
  if (tracks.length === 0) return null;
  if (!preferredLanguage?.trim()) return tracks[0] ?? null;
  return tracks.find((track) => languagesMatch(track.lang, preferredLanguage)) ?? null;
}

function containsWords(text: string, words: string) {
  const normalize = (value: string) =>
    ` ${value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `;
  return normalize(text).includes(normalize(words));
}

export function subtitleTrackLabel(track: SubtitleTrack) {
  const lang = track.lang?.trim();
  const language = lang ? (languageName(lang.toLowerCase()) ?? lang) : null;
  const suppliedTitle = track.title?.trim();
  const title = suppliedTitle?.toLowerCase() === lang?.toLowerCase() ? undefined : suppliedTitle;
  const parts: string[] = [];
  if (language && (!title || !containsWords(title, language))) parts.push(language);
  if (title) parts.push(title);
  if (parts.length === 0) parts.push(`${enUS.player.subtitleTrack} ${track.id}`);
  const name = parts.join(' · ');
  if (track.forced && !containsWords(name, enUS.player.subtitleForced))
    parts.push(enUS.player.subtitleForced);
  if (
    track.hearingImpaired &&
    !containsWords(name, 'SDH') &&
    !containsWords(name, 'hearing impaired')
  )
    parts.push(enUS.player.subtitleSdh);
  const codec = track.codec?.trim();
  if (codec) parts.push(codecLabels[codec.toLowerCase()] ?? codec.toUpperCase());
  return parts.join(' · ');
}

export function labelSubtitleTracks(tracks: SubtitleTrack[]) {
  const labels = tracks.map(subtitleTrackLabel);
  const counts = new Map<string, number>();
  for (const label of labels)
    counts.set(label.toLowerCase(), (counts.get(label.toLowerCase()) ?? 0) + 1);
  return tracks.map((track, index) => {
    const base = labels[index]!;
    // IDs stay stable when mpv reorders tracks or adds an external subtitle.
    const label =
      counts.get(base.toLowerCase())! > 1
        ? `${base} · ${enUS.player.subtitleTrack} ${track.id}`
        : base;
    return { label, track };
  });
}

export function addonSubtitleLabel(subtitle: AddonSubtitle) {
  return (
    (subtitle.lang ? languageName(subtitle.lang.toLowerCase()) : null) ??
    subtitle.lang ??
    'Unknown language'
  );
}

// Add-ons routinely return several subtitles for the same language. Numbering
// the repeats keeps them tellable apart in the menu.
export function labelAddonSubtitles(subtitles: AddonSubtitle[]) {
  const seen = new Map<string, number>();
  return subtitles.map((subtitle) => {
    const base = addonSubtitleLabel(subtitle);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { label: count === 1 ? base : `${base} ${count}`, subtitle };
  });
}

// Stremio stores language preferences as ISO 639-2/B codes.
export const subtitleLanguages = [
  { label: 'English', value: 'eng' },
  { label: 'Spanish', value: 'spa' },
  { label: 'French', value: 'fre' },
  { label: 'German', value: 'ger' },
  { label: 'Italian', value: 'ita' },
  { label: 'Portuguese', value: 'por' },
  { label: 'Dutch', value: 'dut' },
  { label: 'Polish', value: 'pol' },
  { label: 'Russian', value: 'rus' },
  { label: 'Turkish', value: 'tur' },
  { label: 'Japanese', value: 'jpn' },
  { label: 'Korean', value: 'kor' },
  { label: 'Chinese', value: 'chi' },
  { label: 'Hindi', value: 'hin' },
  { label: 'Arabic', value: 'ara' },
];
