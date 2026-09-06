import type { CoreMetaPreview } from '../core/types';
import type { AudioTrack } from './audio';
import { languagesMatch, type AddonSubtitle, type SubtitleTrack } from './subtitles';

type Track = AudioTrack | SubtitleTrack;
type Title = Pick<CoreMetaPreview, 'id' | 'type'>;

interface TrackChoice {
  kind: 'track';
  language: string;
  codec: string;
  title: string;
  ordinal: number;
  count: number;
  external: boolean;
  forced: boolean;
  hearingImpaired: boolean;
}

interface AddonChoice {
  kind: 'addon';
  language: string;
  id: string;
  ordinal: number;
}

export type SubtitleChoice = TrackChoice | AddonChoice | { kind: 'off' };
export interface TitleTrackChoices {
  audio?: TrackChoice;
  subtitle?: SubtitleChoice;
}

const normalized = (value: string | undefined) => value?.trim().toLowerCase() ?? '';
const key = (title: Title) => `kino.tracks.v1:${JSON.stringify([title.type, title.id])}`;

function sameLanguage(left: string | undefined, right: string) {
  return normalized(left) === right || languagesMatch(left, right);
}

function sameTrackKind(track: Track, choice: TrackChoice) {
  return (
    sameLanguage(track.lang, choice.language) &&
    normalized(track.codec) === choice.codec &&
    ('external' in track && track.external) === choice.external &&
    ('forced' in track && track.forced === true) === choice.forced &&
    ('hearingImpaired' in track && track.hearingImpaired === true) === choice.hearingImpaired
  );
}

export function describeTrack(track: Track, tracks: Track[]): TrackChoice {
  const choice: TrackChoice = {
    kind: 'track',
    language: normalized(track.lang),
    codec: normalized(track.codec),
    title: normalized(track.title),
    ordinal: 0,
    count: 0,
    external: 'external' in track && track.external,
    forced: 'forced' in track && track.forced === true,
    hearingImpaired: 'hearingImpaired' in track && track.hearingImpaired === true,
  };
  const matching = tracks.filter((candidate) => sameTrackKind(candidate, choice));
  choice.ordinal = matching.findIndex((candidate) => candidate.id === track.id);
  choice.count = matching.length;
  return choice;
}

export function rememberedTrack<T extends Track>(tracks: T[], choice: TrackChoice | undefined) {
  if (!choice) return null;
  const matching = tracks.filter((track) => sameTrackKind(track, choice));
  const named = choice.title
    ? matching.filter((track) => normalized(track.title) === choice.title)
    : [];
  if (named.length === 1) return named[0];
  if (choice.title && matching.some((track) => normalized(track.title))) return null;
  // A missing same-language variant must not silently select a commentary or
  // forced track just because its native ID happens to occupy the old slot.
  return matching.length === choice.count ? (matching[choice.ordinal] ?? null) : null;
}

export function describeAddonSubtitle(
  subtitle: AddonSubtitle,
  subtitles: AddonSubtitle[],
): AddonChoice {
  return {
    kind: 'addon',
    language: normalized(subtitle.lang),
    id: subtitle.id,
    ordinal: subtitles
      .filter((candidate) => sameLanguage(candidate.lang, normalized(subtitle.lang)))
      .findIndex((candidate) => candidate.id === subtitle.id),
  };
}

export function rememberedAddonSubtitle(subtitles: AddonSubtitle[], choice: AddonChoice) {
  const matching = subtitles.filter((subtitle) => sameLanguage(subtitle.lang, choice.language));
  return matching.find((subtitle) => subtitle.id === choice.id) ?? matching[choice.ordinal] ?? null;
}

function validChoice(value: unknown): value is SubtitleChoice {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Record<string, unknown>;
  if (choice.kind === 'off') return true;
  if (
    typeof choice.language !== 'string' ||
    !Number.isInteger(choice.ordinal) ||
    (choice.ordinal as number) < 0
  )
    return false;
  if (choice.kind === 'addon') return typeof choice.id === 'string';
  return (
    choice.kind === 'track' &&
    typeof choice.codec === 'string' &&
    typeof choice.title === 'string' &&
    Number.isInteger(choice.count) &&
    (choice.count as number) > (choice.ordinal as number) &&
    ['external', 'forced', 'hearingImpaired'].every((field) => typeof choice[field] === 'boolean')
  );
}

export function loadTitleTrackChoices(title: Title): TitleTrackChoices {
  try {
    const value = JSON.parse(localStorage.getItem(key(title)) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return {
      ...(validChoice(value.audio) && value.audio.kind === 'track' ? { audio: value.audio } : {}),
      ...(validChoice(value.subtitle) ? { subtitle: value.subtitle } : {}),
    };
  } catch {
    return {};
  }
}

export function saveTitleTrackChoice(
  title: Title,
  choice: Pick<TitleTrackChoices, 'audio'> | Pick<TitleTrackChoices, 'subtitle'>,
) {
  try {
    localStorage.setItem(
      key(title),
      JSON.stringify({ ...loadTitleTrackChoices(title), ...choice }),
    );
  } catch {
    // Playback and manual selection still work when device storage is full.
  }
}
