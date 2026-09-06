import { describe, expect, it } from 'vitest';

import { hints, torrentSource, urlSource } from '../test/coreState';
import {
  hasStructure,
  runtimeMinutes,
  sizeLabel,
  sourceFields,
  withEstimatedBitrate,
} from './sourceFields';

// Real add-on text, lightly anonymised. The shapes matter, not the titles.
const remux = torrentSource(
  {},
  {
    name: 'Torrentio\n4k DV',
    description:
      'Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR\n👤 101 💾 54.33 GB ⚙️ TorrentGalaxy',
    hints: hints({
      filename: 'Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR.mkv',
    }),
  },
);

describe('source fields', () => {
  it('reads a scene release name into comparable fields', () => {
    const fields = sourceFields(remux);
    expect(fields).toMatchObject({
      resolution: '2160p',
      releaseType: 'Remux',
      releaseGroup: 'FraMeSToR',
      audio: 'DTS-HD MA 5.1',
      videoCodec: 'HEVC',
      videoRange: 'DV',
      peers: 101,
      languages: [],
    });
    expect(sizeLabel(fields.size)).toBe('54.3 GB');
    // The marker line was consumed; nothing is left over for the details view.
    expect(fields.original.remainder).toEqual([]);
    expect(fields.original.filename).toMatch(/FraMeSToR\.mkv$/);
  });

  it('keeps authored spacing and brackets from confusing the group and codec', () => {
    const fields = sourceFields(
      torrentSource(
        {},
        {
          name: 'Torrentio\n4k HDR',
          description:
            'Some Film (1994) (2160p BluRay x265 HEVC 10bit HDR AAC 5.1 Tigole) [QxR]\n👤 39 💾 17.1 GB ⚙️ 1337x',
          hints: hints({ filename: 'Some Film (1994) (2160p BluRay x265 10bit HDR Tigole).mkv' }),
        },
      ),
    );
    expect(fields).toMatchObject({
      resolution: '2160p',
      releaseType: 'BluRay',
      videoCodec: 'HEVC',
      videoRange: 'HDR',
      audio: 'AAC 5.1',
    });
    // The filename is the fuller spelling, and it carries no bracketed group.
    expect(fields.releaseGroup).toBeNull();
  });

  it('turns flags into language codes and combines range claims', () => {
    const fields = sourceFields(
      torrentSource(
        {},
        {
          name: 'Torrentio\n4k DV | HDR',
          description:
            'Le.ali.1994.UHDRip.2160p.Hevc.HDR.AC3.ITA.ENG.SUBS.LFi.mkv\n👤 6 💾 23.58 GB ⚙️ 1337x\n🇬🇧 / 🇮🇹',
        },
      ),
    );
    expect(fields.languages).toEqual(['EN', 'IT']);
    expect(fields.videoRange).toBe('DV + HDR');
    expect(fields.releaseType).toBe('BDRip');
    expect(fields.audio).toBe('AC3');
  });

  it('falls back to three-letter tokens only when no flags are given', () => {
    const fields = sourceFields(
      urlSource('https://a.invalid/v.mkv', {
        description: 'Some Film 2160p H265 HDR10 DV ITA DTS 5.1 ENG AC3 5.1 SUB ITA ENG',
      }),
    );
    expect(fields.languages).toEqual(['IT', 'EN']);
    expect(fields.videoRange).toBe('DV + HDR10');
    expect(fields.videoCodec).toBe('HEVC');
  });

  it('never infers SDR and only reports it when the add-on states it', () => {
    expect(
      sourceFields(urlSource('https://a.invalid/v.mkv', { description: 'Film 1080p WEB-DL x264' }))
        .videoRange,
    ).toBeNull();
    expect(
      sourceFields(
        urlSource('https://a.invalid/v.mkv', { description: 'Film.2160p.MA.WEB-Group SDR 4k UHD' }),
      ).videoRange,
    ).toBe('SDR');
  });

  it('shows a slash-joined size as written rather than labelling its halves', () => {
    const fields = sourceFields(
      torrentSource({}, { description: 'Show S01E03 1080p WEB-DL\n📦 6.8 / 13.6 GB' }),
    );
    expect(fields.size).toEqual({ kind: 'text', text: '6.8 / 13.6 GB' });
    expect(sizeLabel(fields.size)).toBe('6.8 / 13.6 GB');
    // No bitrate can be estimated from an ambiguous size.
    expect(withEstimatedBitrate(fields, '45 min').bitrate).toBeNull();
  });

  it('prefers the structured size hint over text and estimates bitrate from runtime', () => {
    const fields = sourceFields(
      urlSource('https://a.invalid/v.mkv', {
        description: 'Film 1080p 💾 9.99 GB',
        hints: hints({ videoSize: 5 * 1024 ** 3 }),
      }),
    );
    expect(sizeLabel(fields.size)).toBe('5.0 GB');
    expect(withEstimatedBitrate(fields, '2h 0min').bitrate).toBe('~6.0 Mbps');
    expect(withEstimatedBitrate(fields, null).bitrate).toBeNull();
  });

  it('quotes a bitrate the add-on states instead of estimating', () => {
    const fields = sourceFields(
      urlSource('https://a.invalid/v.mkv', {
        description: 'Film 1080p 12.5 Mbps',
        hints: hints({ videoSize: 5 * 1024 ** 3 }),
      }),
    );
    expect(withEstimatedBitrate(fields, '2h').bitrate).toBe('12.5 Mbps');
  });

  it('leaves a plain direct stream unstructured with its label as the title', () => {
    const fields = sourceFields(
      urlSource('https://cdn.invalid/play', { name: 'Debrid', description: 'Instant stream' }),
    );
    expect(hasStructure(fields)).toBe(false);
    expect(fields.fallbackTitle).toBe('Instant stream');
    expect(fields.original.remainder).toEqual([]);
  });

  it('keeps unrecognised add-on text for the details view', () => {
    const fields = sourceFields(
      torrentSource(
        {},
        {
          name: 'Torrentio\n4k',
          description:
            'Film (1994) Featurettes (2160p BluRay x265 10bit DTS 5.1 Joy) [UTR]\nFilm (1994) [2160p x265 10bit FS97 Joy].mkv\n👤 56 💾 7.13 GB ⚙️ 1337x',
        },
      ),
    );
    // The add-on's own label is not unexplained text; the second release line is.
    expect(fields.original.remainder).toEqual(['Film (1994) [2160p x265 10bit FS97 Joy].mkv']);
    expect(fields.resolution).toBe('2160p');
  });

  it('reads a codec written flush against its layout and a bracketed group before the extension', () => {
    const fields = sourceFields(
      torrentSource(
        {},
        {
          description: 'Film 1994 2160p BluRay\n👤 100 💾 6.91 GB ⚙️ YTS',
          hints: hints({
            filename: 'Film.1994.2160p.4K.BluRay.x265.10bit.HDR.AAC5.1-[YTS.MX].mkv',
          }),
        },
      ),
    );
    expect(fields.audio).toBe('AAC 5.1');
    expect(fields.releaseGroup).toBe('YTS.MX');
  });

  it('does not read a hyphenated title or a layout as the release group', () => {
    expect(
      sourceFields(urlSource('https://a.invalid/v.mkv', { description: 'Spider-Man 2002 1080p' }))
        .releaseGroup,
    ).toBeNull();
    expect(
      sourceFields(urlSource('https://a.invalid/v.mkv', { description: 'Film.1080p.AAC-5.1' }))
        .releaseGroup,
    ).toBeNull();
  });

  it('parses the runtime strings Core displays', () => {
    expect(runtimeMinutes('142 min')).toBe(142);
    expect(runtimeMinutes('2h 22min')).toBe(142);
    expect(runtimeMinutes('45')).toBe(45);
    expect(runtimeMinutes('unknown')).toBeNull();
    expect(runtimeMinutes(null)).toBeNull();
  });
});
