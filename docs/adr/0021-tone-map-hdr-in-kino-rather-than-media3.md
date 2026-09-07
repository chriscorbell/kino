# Tone map HDR in Kino's own shader rather than through Media3

## Status

Accepted

## Context

[ADR 0003](0003-use-separate-desktop-and-tv-stacks.md) reserved a switch of only the TV playback layer to libmpv if Media3 could not meet the playback contract. HDR is where that question came due.

Media3 cannot tone map on the Shield in any released version. Its HDR path compiles a fragment shader that opens with `#extension GL_EXT_YUV_target : require`, and the Tegra driver does not expose that extension, so playback stops with `PlaybackException` 7001 and a shader compile error before a frame is drawn. The decoder-side alternative, `MediaFormat.KEY_COLOR_TRANSFER_REQUEST`, needs API 31; the Shield is API 30 and NVIDIA has shipped no newer Android for it. Kino rejected HDR sources as a result, which contradicted the contract's own promise to tone map them.

The obvious reading was that the hardware could not do it. Taking frames out of the decoder without a Surface returns eight-bit `YUV_420_888` at one byte per luma sample, so an application-side tone mapper appeared to have no ten-bit data to work from, and that is the constraint every other Android client runs into. Kodi's developers describe firmware tone mapping on the Surface path as a black box the application cannot influence. Jellyfin, Plex and Emby move the conversion to a server transcode, which Kino has no server for.

That reading was wrong, and the measurement that corrects it is the basis of this decision. The eight-bit result describes the ByteBuffer path only. Media3 requires the extension in order to apply the colour matrix itself, not in order to reach the pixels: `OES_EGL_image_external` already specifies that sampling an external texture returns RGB "in the same colorspace as the source image", including its non-linear encoding. Measured on the development Shield, the Tegra driver honours that exactly. It applies the BT.2020 non-constant-luminance matrix, worst channel error 0.0107 against chroma patches the candidate matrices disagree about by an order of magnitude more. It expands limited range to full. It applies no transfer conversion, so frames arrive still PQ encoded. It preserves all ten bits: sixteen luma steps one code apart come back distinct at a mean 0.001139 against the 0.001142 that one code represents, where an eight-bit path would quantise to 0.003906 and collapse them. `docs/research/tv-hdr-tone-mapping.md` records the survey and the numbers.

## Decision

Kino tone maps HDR itself, in its own fragment shader, and keeps Media3 as the TV playback layer.

Frames are hardware decoded to a Surface exactly as they are today and sampled with a plain `samplerExternalOES`, which needs no extension the Shield lacks. `HdrToneMapper` then rolls highlights off with the ITU-R BT.2390 EETF in the PQ domain where that curve is defined, applies the SMPTE ST 2084 EOTF, converts BT.2020 to BT.709 in linear light, clips, and encodes for a BT.1886 display, matching the desktop client's `target-trc`. The intermediate is `RGBA16F`; an eight-bit intermediate would discard the precision the driver preserved.

The conversion does not route through Media3's `DefaultVideoFrameProcessor`. Reaching its SDR sampler by declaring the input SDR would also drop its intermediate textures to eight bits, because `useHdr` is what gates `GL_RGBA16F` there.

Source peak luminance defaults to 1000 cd/m² and the target is BT.2408 reference white at 203 cd/m².

## Consequences

Hardware decoding is untouched, so [ADR 0009](0009-render-video-as-sdr-without-software-decoding.md) holds unchanged and no software video decoder is introduced. The libmpv switch ADR 0003 reserved is not taken, and the TV client keeps one playback stack, one set of track handling, and one shutdown sequence.

Because the arithmetic is Kino's, it can be gated rather than trusted. `scripts/test-support/tone-map-reference.mjs` implements the same pipeline a second time on the host, and `ShieldToneMapTest` decodes the real fixture on the Shield and compares the rendered pixels against it, so an error has to be made twice in two languages to pass. Dropping the gamut conversion, skipping the tone curve, omitting the EOTF, or changing the display gamma each fail it.

The gate's tolerance is set by the device, not by Kino. The Tegra driver centres chroma on about 510 rather than 512, a constant two-code offset that propagates to roughly 0.018 of output error, and GPU transcendental precision adds the rest of the measured 0.026 worst case. Correcting that offset in the shader would bake a driver quirk into Kino and become an equal and opposite error the day a driver fixes it, so it is documented instead.

This covers HDR10 and PQ. HLG and Dolby Vision remain rejected until each is measured the same way, and the probes assert the device's current limits so that a driver or platform update which changes them fails the suite and prompts a revisit rather than passing silently.
