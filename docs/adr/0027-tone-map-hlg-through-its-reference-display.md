# Tone map HLG through its reference display

## Status

Accepted

## Context

[ADR 0021](0021-tone-map-hdr-in-kino-rather-than-media3.md) gave the TV its own HDR10 shader and left HLG and Dolby Vision rejected until each was measured the same way. The desktop already played HLG through mpv, but nothing checked what it drew. The playback contract promises HLG tone mapped to SDR on every client.

HLG differs from PQ in two ways that matter here. Its signal describes scene light, not display light, and it carries no mastering metadata: BT.2100 defines the display instead, with an OOTF whose system gamma is 1.2 on a 1000 cd/m² reference display. BT.2408 converts HLG to PQ through that same display.

Dolby Vision profile 8.4 has an HLG base layer. The TV's HEVC decoder never sees its RPU. On the desktop, mpv attached the RPU and labelled the frames PQ, and with the RPU stripped it still marked them as display light, so HLG's OOTF was skipped and the shadows came out lifted.

## Decision

Both clients convert an HLG pixel through BT.2100's OOTF on a 1000 cd/m² display into PQ, then tone map it exactly as HDR10: the BT.2390 roll-off from a 1000 cd/m² peak to 203 cd/m², BT.2020 to BT.709 in linear light, and BT.1886 encoding.

- The TV shader does this itself when the stream's transfer is HLG. `scripts/test-support/tone-map-reference.mjs` does it a second time on the host.
- mpv already does the same on the desktop, measured within the gate's tolerances.
- Dolby Vision profile 8 plays its cross-compatible base layer on both clients. The desktop strips the RPU with mpv's `format` filter, and for a base layer that comes out HLG it sets HLG's light, for that file only.

## Consequences

An HLG probe with every pixel a known code word, and a Dolby Vision 8.4 wrapping of it, join the pixel gates on the Mac and the Shield, against the host reference. An HLG source now plays on the TV instead of being refused.

The desktop no longer applies profile 8.1's RPU either, so a film graded with Dolby Vision trims shows its HDR10 base layer, as it already did on the TV. That fits [ADR 0026](0026-tone-map-desktop-hdr-from-metadata.md): tone mapping follows the stream's static description, not per-scene data.

The TV still rejects profiles 5, 7 and 9, and the desktop still refuses profile 5, which has no base layer either renderer can show.
