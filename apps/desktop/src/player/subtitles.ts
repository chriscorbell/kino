export interface SubtitleTrack {
  codec?: string;
  external: boolean;
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

export function subtitleTrackLabel(track: SubtitleTrack) {
  const name =
    (track.lang ? languageName(track.lang.toLowerCase()) : null) ??
    track.title?.trim() ??
    track.lang ??
    `Track ${track.id}`;
  const codec = track.codec ? codecLabels[track.codec] : undefined;
  return codec ? `${name} · ${codec}` : name;
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
