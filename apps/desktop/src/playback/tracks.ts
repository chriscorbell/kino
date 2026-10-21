// Per-title track memory: restoring the viewer's audio and subtitle choice once
// a load is ready, restoring a remembered add-on subtitle when Core's list
// arrives later, and remembering what the viewer picks. Restoration never
// writes a choice. scripts/check-macos-track-choices.mjs reads the storage key.

import type { CoreMetaPreview } from '../core/types';
import type { AudioTrack } from '../player/audio';
import {
  addonSubtitleLabel,
  languagesMatch,
  preferredSubtitleTrack,
  type AddonSubtitle,
  type SubtitleTrack,
} from '../player/subtitles.ts';
import type { MediaBackend } from './media';

type Track = AudioTrack | SubtitleTrack;
type Title = Pick<CoreMetaPreview, 'id' | 'type'>;
type TrackStorage = Pick<Storage, 'getItem' | 'setItem'>;

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

type SubtitleChoice = TrackChoice | AddonChoice | { kind: 'off' };
interface TitleTrackChoices {
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

function describeTrack(track: Track, tracks: Track[]): TrackChoice {
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

function rememberedTrack<T extends Track>(tracks: T[], choice: TrackChoice | undefined) {
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

function describeAddonSubtitle(subtitle: AddonSubtitle, subtitles: AddonSubtitle[]): AddonChoice {
  return {
    kind: 'addon',
    language: normalized(subtitle.lang),
    id: subtitle.id,
    ordinal: subtitles
      .filter((candidate) => sameLanguage(candidate.lang, normalized(subtitle.lang)))
      .findIndex((candidate) => candidate.id === subtitle.id),
  };
}

function rememberedAddonSubtitle(subtitles: AddonSubtitle[], choice: AddonChoice) {
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

function loadTitleTrackChoices(storage: TrackStorage, title: Title): TitleTrackChoices {
  try {
    const value = JSON.parse(storage.getItem(key(title)) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return {
      ...(validChoice(value.audio) && value.audio.kind === 'track' ? { audio: value.audio } : {}),
      ...(validChoice(value.subtitle) ? { subtitle: value.subtitle } : {}),
    };
  } catch {
    return {};
  }
}

function saveTitleTrackChoice(
  storage: TrackStorage,
  title: Title,
  choice: Pick<TitleTrackChoices, 'audio'> | Pick<TitleTrackChoices, 'subtitle'>,
) {
  try {
    storage.setItem(
      key(title),
      JSON.stringify({ ...loadTitleTrackChoices(storage, title), ...choice }),
    );
  } catch {
    // Playback and manual selection still work when device storage is full.
  }
}

interface TrackState {
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
  /** Add-on subtitles Core offers that this load has not added. */
  addon: AddonSubtitle[];
}

/**
 * The tracks of one session. `load` starts each load over, since the player
 * reports a new file's tracks from scratch; what the view shows stays until
 * the new load reports.
 */
export function createTracks({
  title,
  storage,
  defaults,
  onChange,
}: {
  title: Title;
  storage: TrackStorage;
  /** The Kino `subtitles` setting and the profile's subtitle language. */
  defaults(): { enabled: boolean; language: string | null };
  onChange(state: TrackState): void;
}) {
  const newLoad = () => ({
    choices: loadTitleTrackChoices(storage, title),
    starting: true,
    ready: false,
    audioDone: false,
    subtitleDone: false,
    subtitleFallbackDone: false,
    audio: [] as AudioTrack[],
    subtitles: [] as SubtitleTrack[],
    addedAddons: new Map<number, AddonSubtitle>(),
    addonsByToken: new Map<string, AddonSubtitle>(),
  });
  let backend: MediaBackend | null = null;
  let current = newLoad();
  let audio: AudioTrack[] = [];
  let subtitles: SubtitleTrack[] = [];
  let offered: AddonSubtitle[] = [];
  let addedUrls: ReadonlySet<string> = new Set();

  const changed = () =>
    onChange({ audio, subtitles, addon: offered.filter(({ url }) => !addedUrls.has(url)) });
  const switchable = () => (backend?.capabilities.tracks ? backend : null);

  function attachAddon(target: MediaBackend, subtitle: AddonSubtitle) {
    // mpv reports the supplied title but no add-request ID. An opaque title
    // correlates each result even when another same-language download fails.
    // Track snapshots replace it with the normal display label.
    const token = crypto.randomUUID();
    current.addonsByToken.set(token, subtitle);
    addedUrls = new Set(addedUrls).add(subtitle.url);
    target.addSubtitles(subtitle.url, token, subtitle.lang);
    changed();
  }

  // Switching tracks while mpv initializes its decoders can prevent the first
  // frame from arriving, so nothing is restored before the load is ready.
  function restore() {
    if (!backend || !current.ready) return;
    if (!current.audioDone && current.audio.length > 0) {
      current.audioDone = true;
      const track = rememberedTrack(current.audio, current.choices.audio);
      if (track) backend.setAudioTrack(track.id);
    }
    if (current.subtitleDone) return;
    const choice = current.choices.subtitle;
    if (choice?.kind === 'off') {
      current.subtitleDone = true;
      backend.setSubtitleTrack(null);
    } else if (current.subtitles.length > 0 && !current.subtitleFallbackDone) {
      current.subtitleFallbackDone = true;
      // Add-on lists may arrive later. Keep their restoration pending while
      // using the ordinary embedded subtitle defaults.
      current.subtitleDone = choice?.kind !== 'addon';
      const remembered = rememberedTrack(
        current.subtitles,
        choice?.kind === 'track' ? choice : undefined,
      );
      const { enabled, language } = defaults();
      const track =
        remembered ?? (enabled ? preferredSubtitleTrack(current.subtitles, language) : null);
      if (track) backend.setSubtitleTrack(track.id);
    }
  }

  function restoreAddon() {
    const target = switchable();
    const choice = current.choices.subtitle;
    if (!target || current.subtitleDone || !current.ready || choice?.kind !== 'addon') return;
    const subtitle = rememberedAddonSubtitle(offered, choice);
    if (!subtitle) return;
    current.subtitleDone = true;
    attachAddon(target, subtitle);
  }

  return {
    load(target: MediaBackend) {
      backend = target;
      current = newLoad();
    },
    buffering() {
      if (!current.starting) return;
      current.starting = false;
      addedUrls = new Set();
      changed();
    },
    ready() {
      current.ready = true;
      restore();
      restoreAddon();
    },
    audioTracks(tracks: AudioTrack[]) {
      current.audio = audio = tracks;
      changed();
      restore();
    },
    subtitleTracks(tracks: SubtitleTrack[]) {
      current.subtitles = subtitles = tracks.map((track) => {
        const subtitle = track.external ? current.addonsByToken.get(track.title ?? '') : undefined;
        if (!subtitle) return track;
        current.addedAddons.set(track.id, subtitle);
        return { ...track, title: addonSubtitleLabel(subtitle) };
      });
      changed();
      restore();
    },
    /** Core's add-on subtitles for the source. */
    offered(list: AddonSubtitle[]) {
      offered = list;
      changed();
      restoreAddon();
    },
    selectAudio(id: number) {
      const target = switchable();
      if (!target) return;
      current.audioDone = true;
      const track = audio.find((candidate) => candidate.id === id);
      if (track) saveTitleTrackChoice(storage, title, { audio: describeTrack(track, audio) });
      target.setAudioTrack(id);
    },
    /** Returns whether the choice applied, so the caller can keep the `subtitles` setting in step. */
    selectSubtitle(id: number | null) {
      const target = switchable();
      if (!target) return false;
      current.subtitleDone = true;
      const track = subtitles.find((candidate) => candidate.id === id);
      const addon = track?.external ? current.addedAddons.get(track.id) : undefined;
      if (id === null || track) {
        saveTitleTrackChoice(storage, title, {
          subtitle:
            id === null
              ? { kind: 'off' }
              : addon
                ? describeAddonSubtitle(addon, offered)
                : describeTrack(track!, subtitles),
        });
      }
      target.setSubtitleTrack(id);
      return true;
    },
    /** Returns whether the subtitle was added. */
    addAddon(subtitle: AddonSubtitle) {
      const target = switchable();
      if (!target || addedUrls.has(subtitle.url)) return false;
      current.subtitleDone = true;
      saveTitleTrackChoice(storage, title, {
        subtitle: describeAddonSubtitle(subtitle, offered),
      });
      attachAddon(target, subtitle);
      return true;
    },
  };
}
