import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { availableSeasons, seasonEpisodes } from '../core/seasons';
import { hasStructure, sizeLabel, sourceFields, withEstimatedBitrate } from '../core/sourceFields';
import { introFromChapters, type ChapterCue } from '../intro/markers';
import { inUpNextWindow } from '../player/upNext';
import { hints, urlSource, video } from '../test/coreState';
import { compareVersions } from '../updates/releases';

// The TV app's JVM tests read the same JSON, so a rule both clients implement
// cannot change on one side without the shared case failing on the other.
function cases<Case>(name: string): Case[] {
  const text = readFileSync(`../../fixtures/parity/${name}.json`, 'utf8');
  return (JSON.parse(text) as { cases: Case[] }).cases;
}

interface SourceFieldsCase {
  name: string;
  input: {
    name?: string;
    description?: string;
    filename?: string;
    videoSize?: number;
    runtime?: string;
  };
  expect: Record<string, unknown>;
}

describe('source fields', () => {
  for (const { name, input, expect: expected } of cases<SourceFieldsCase>('source-fields')) {
    it(name, () => {
      const fields = sourceFields(
        urlSource('https://a.invalid/v.mkv', {
          name: input.name ?? null,
          description: input.description ?? null,
          hints: hints({ filename: input.filename ?? null, videoSize: input.videoSize ?? null }),
        }),
      );
      const observed: Record<string, unknown> = {
        resolution: fields.resolution,
        releaseType: fields.releaseType,
        releaseGroup: fields.releaseGroup,
        languages: fields.languages,
        audio: fields.audio,
        videoCodec: fields.videoCodec,
        videoRange: fields.videoRange,
        peers: fields.peers,
        fallbackTitle: fields.fallbackTitle,
        structured: hasStructure(fields),
        sizeLabel: sizeLabel(fields.size),
        bitrateLabel: withEstimatedBitrate(fields, input.runtime ?? null).bitrate,
        filename: fields.original.filename,
        remainder: fields.original.remainder,
      };
      for (const [key, value] of Object.entries(expected)) {
        expect(key in observed, `observes ${key}`).toBe(true);
        expect(observed[key], key).toEqual(value);
      }
    });
  }
});

interface VersionsCase {
  left: string;
  right: string;
  expect: number | null;
}

describe('version order', () => {
  for (const { left, right, expect: order } of cases<VersionsCase>('versions')) {
    it(`${left} against ${right}`, () => {
      expect(compareVersions(left, right)).toBe(order);
      expect(compareVersions(right, left)).toBe(order && -order);
    });
  }
});

interface SeasonsCase {
  name: string;
  videos: { id: string; season?: number; episode?: number }[];
  expect: { season: number | null; episodes: string[] }[];
}

describe('seasons', () => {
  for (const { name, videos: listed, expect: expected } of cases<SeasonsCase>('seasons')) {
    it(name, () => {
      const videos = listed.map(({ id, season = null, episode = null }) =>
        video({ id, season, episode }),
      );
      const observed = availableSeasons(videos).map((season) => ({
        season,
        episodes: seasonEpisodes(videos, season).map(({ id }) => id),
      }));
      expect(observed).toEqual(expected);
    });
  }
});

interface UpNextCase {
  name: string;
  positionMs: number;
  durationMs: number;
  expect: boolean;
}

describe('Up Next window', () => {
  for (const { name, positionMs, durationMs, expect: offered } of cases<UpNextCase>('up-next')) {
    it(name, () => {
      expect(inUpNextWindow(positionMs, durationMs)).toBe(offered);
    });
  }
});

interface IntroChaptersCase {
  name: string;
  chapters: ChapterCue[];
  durationMs: number;
  expect: { result: 'found' | 'absent' | 'unknown'; startMs?: number; endMs?: number };
}

describe('intro chapters', () => {
  for (const { name, chapters, durationMs, expect: expected } of cases<IntroChaptersCase>(
    'intro-chapters',
  )) {
    it(name, () => {
      const intro = introFromChapters(chapters, durationMs);
      expect(
        typeof intro === 'string'
          ? { result: intro }
          : { result: 'found', startMs: intro.startMs, endMs: intro.endMs },
      ).toEqual(expected);
    });
  }
});
