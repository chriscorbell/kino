import { localeTag, t } from '../locales';

export interface AudioTrack {
  id: number;
  selected: boolean;
  lang?: string;
  title?: string;
  codec?: string;
}

export function parseAudioTracks(value: unknown): AudioTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AudioTrack[] => {
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.id) || entry.id <= 0)
      return [];
    return [
      {
        id: entry.id,
        selected: entry.selected === true,
        ...(typeof entry.lang === 'string' ? { lang: entry.lang } : {}),
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
        ...(typeof entry.codec === 'string' ? { codec: entry.codec } : {}),
      },
    ];
  });
}

export function audioTrackLabel(track: AudioTrack) {
  let language = track.lang?.trim();
  if (language) {
    try {
      language = new Intl.DisplayNames([localeTag], { type: 'language' }).of(language) ?? language;
    } catch {
      /* Keep an add-on or demuxer's language code when it is unfamiliar. */
    }
  }
  const title = track.title?.trim();
  const parts = [...new Set([language, title].filter(Boolean))];
  if (parts.length === 0) parts.push(t.player.audioTrack(track.id));
  if (track.codec) parts.push(track.codec.toUpperCase());
  return parts.join(' · ');
}
