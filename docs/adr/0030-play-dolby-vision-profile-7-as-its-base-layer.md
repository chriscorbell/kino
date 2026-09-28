# Play Dolby Vision profile 7 as its base layer

## Status

Accepted

## Context

Profile 7 is the Dolby Vision of UHD Blu-ray, so it is what a disc remux carries. One track holds two layers: a base layer that is the disc's complete HDR10 picture, which a player without Dolby Vision shows, and an enhancement layer with an RPU that a Dolby Vision player combines with it into a twelve-bit signal. A minimal enhancement layer adds nothing; a full one adds precision to the same grade.

[ADR 0027](0027-tone-map-hlg-through-its-reference-display.md) played profile 8's base layer on both clients and left the TV rejecting profile 7 until it was measured. The desktop already showed profile 7's base layer, because mpv strips every RPU and FFmpeg skips the enhancement layer, but no gate checked what it drew. Media3 offers HEVC decoders for profile 8's base layer and not for profile 7's, calling it not always backward compatible, so on the TV every profile 7 source failed.

Kino outputs SDR. Combining the layers would need Dolby's reconstruction, which neither renderer performs, and it would only refine the HDR picture before tone mapping discards most of that range.

## Decision

Both clients play profile 7's base layer as HDR10 and ignore its enhancement layer and RPU.

- The TV asks the selector for HEVC decoders itself for any Dolby Vision track it accepts, instead of relying on Media3's alternative lookup, and accepts profile 7 when the container tags its colour, as it does profile 8.
- The desktop keeps mpv's `format:dolbyvision=no` filter for every file.

## Consequences

A profile 7 variant of the HDR probe, made with `dovi_tool` as a UHD Blu-ray lays it out, joins the pixel gates on the Shield and the desktop and must match the HDR10 reference exactly. On the TV its enhancement layer's units pass through the HEVC decoder without changing a pixel.

A disc remux now plays on the TV instead of failing. A film with a full enhancement layer shows the same HDR10 grade a player without Dolby Vision shows.

The TV still rejects every other profile, and the desktop still refuses profile 5.
