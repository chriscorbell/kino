import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { hasStructure, sizeLabel, sourceFields, withEstimatedBitrate } from '../core/sourceFields';
import { hints, urlSource } from '../test/coreState';

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
